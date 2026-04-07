# Dialogue Mode — AI-Assisted Conversation for NoteWriter

## Overview

Dialogue mode is a new menu item in NoteWriter for Even Realities G2 glasses. It listens to speech, translates it in real-time (like Listen mode), but adds AI-generated responses. When the user clicks, listening pauses, GPT-4.1-nano generates a contextual response as the user's persona, and displays it on the glasses. The user reads/speaks the answer, then clicks again to resume listening.

Use case: language exams, guided conversations, real-time dialogue assistance.

## Tech Addition

| Component | Technology |
|---|---|
| Response generation | OpenAI GPT-4.1-nano (streaming, ~650ms TTFT) |

OpenAI API key stored in KV alongside existing keys. Proxied through Cloudflare Worker.

## Dialogue Flow

### States

```
LISTENING → (Click) → GENERATING → (response ready) → SHOWING_ANSWER → (Click) → LISTENING
                                                        (Double-click) → PAUSED
PAUSED → (Click) → LISTENING
PAUSED → (Double-click) → EXIT to menu
```

### State Details

**LISTENING** — identical to Listen mode. STT captures speech, translates in real-time. Committed sentences are accumulated in a conversation history array.

**GENERATING** — triggered by Click. STT stops, audio capture pauses. The last committed sentence(s) plus the full conversation history are sent to `POST /api/dialogue/generate`. The screen shows "Generating..." with the last heard phrase.

**SHOWING_ANSWER** — GPT response streams onto the screen. Shows the generated response in the original language plus translation to target language. User reads/speaks the answer.

**PAUSED** — from SHOWING_ANSWER via Double-click. Shows pause screen. Click resumes LISTENING. Double-click exits to menu.

### Screen Layouts

**LISTENING:**
```
* Γεια σας, πώς σας λένε;
Здравствуйте, как вас зовут?
```

**GENERATING:**
```
Generating...

Q: Γεια σας, πώς σας λένε;
(Здравствуйте, как вас зовут?)
```

**SHOWING_ANSWER:**
```
> Με λένε Αλέξανδρος. Ζω στην Κύπρο.

Меня зовут Александрос. Живу на Кипре.
```

## GPT Prompt Design

### System prompt

```
You are a dialogue assistant. You help the user respond in conversations.

Context: {context}
Persona: {persona}

Rules:
- Generate a response as if you ARE the persona
- Respond in the SAME language as the last question/statement
- Keep responses short (1-3 sentences), appropriate for spoken dialogue
- If the persona description doesn't cover the topic, improvise naturally within the given context
- After the response, add a translation to {target_language_name}

Format your response EXACTLY as:
RESPONSE: [response in the original language]
TRANSLATION: [translation to target language]
```

### Input

The conversation history (last 10-15 turns) as user messages, with the latest committed phrase as the final message. Each turn is marked as "other" (the person being listened to) or "self" (the generated response the user spoke).

### Output parsing

Worker parses `RESPONSE:` and `TRANSLATION:` from GPT output. If parsing fails, the full text is shown as-is.

## Worker API

### New endpoint

**POST /api/dialogue/generate**

Request:
```json
{
  "messages": [
    { "role": "other", "text": "Γεια σας, πώς σας λένε;" },
    { "role": "self", "text": "Με λένε Αλέξανδρος." },
    { "role": "other", "text": "Τι κάνετε το βράδυ;" }
  ],
  "context": "Я нахожусь на экзамене по греческому языку...",
  "persona": "Меня зовут Александр, мне 40 лет...",
  "source_lang": "el",
  "target_lang": "ru"
}
```

Response (streamed, SSE):
```
data: {"chunk": "Με λένε"}
data: {"chunk": " Αλέξανδρος."}
data: {"done": true, "response": "Με λένε Αλέξανδρος.", "translation": "Меня зовут Александрос."}
```

Worker uses the user's OpenAI key from KV. Proxies the streaming response from OpenAI API.

## Database Changes

### D1: sessions table — add `mode` column

```sql
ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'listen';
```

Values: `'listen'` | `'dialogue'`

### D1: settings table — add context/persona columns

```sql
ALTER TABLE settings ADD COLUMN context TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN persona TEXT NOT NULL DEFAULT '';
```

### KV: keys — add openai_key

```json
{
  "elevenlabs_key": "encrypted",
  "aws_access_key_id": "encrypted",
  "aws_secret_access_key": "encrypted",
  "aws_region": "eu-west-1",
  "openai_key": "encrypted"
}
```

## Phone UI Changes

### Keys tab — new field

Add "OpenAI API Key" field with eye-toggle, same pattern as other keys.

### Settings tab — new section

Add "Dialogue Settings" section below language settings:
- **Context** — textarea, placeholder: "e.g. I'm at a Greek language exam..."
- **Persona** — textarea, placeholder: "e.g. My name is Alexander, I'm 40 years old..."
- Both saved via `PUT /api/settings` (same endpoint, extended payload).

### History tab — session type indicator

Show mode badge on each session item: "Listen" or "Dialogue".

## Glasses UI Changes

### Menu — new item

```
> Listen
  Dialogue
  History
  Settings
```

Dialogue is grayed out if OpenAI key is not configured.

### State management

`appState` gets:
- `dialogueContext: string` — loaded from settings
- `dialoguePersona: string` — loaded from settings
- `openaiKeyConfigured: boolean` — checked alongside other keys

## File Changes

### New files
- `src/glasses/dialogue.ts` — Dialogue mode UI + state machine
- `worker/src/dialogue.ts` — OpenAI streaming proxy

### Modified files
- `src/glasses/menu.ts` — add Dialogue item
- `src/main.ts` — wire dialogue event handler
- `src/services/api.ts` — add `generateDialogue()` method
- `src/services/state.ts` — add dialogue-related state
- `src/types.ts` — add DialogueMessage, DialogueSettings types
- `src/phone/keys.ts` — add OpenAI key field
- `src/phone/settings.ts` — add context/persona textareas
- `src/phone/history.ts` — show session mode badge
- `index.html` — add OpenAI key field + context/persona textareas + CSS
- `worker/src/index.ts` — wire dialogue route
- `worker/src/types.ts` — add DialogueRequest type
- `worker/src/settings.ts` — handle context/persona fields
- `worker/src/keys.ts` — handle openai_key
- `worker/migrations/0002_dialogue.sql` — schema migration

## Session History in Dialogue

Each committed sentence from the "other" speaker is saved as a paragraph (like Listen). Each generated response is also saved as a paragraph with a flag indicating it was AI-generated. This preserves the full conversation for review in History.

The conversation history (in-memory during the session) is passed to GPT for context continuity. Limited to last 15 turns to keep token usage low.

## Cost Estimate

GPT-4.1-nano: ~$0.10/M input, $0.40/M output.
Typical dialogue turn: ~300 input tokens (history + persona + context), ~50 output tokens.
Cost per response: ~$0.00005 (~0.005 cents). Negligible.
