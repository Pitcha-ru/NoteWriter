# Stealth Mode — Design Spec

**Date:** 2026-05-13  
**Status:** Approved

## Overview

Add a new "Stealth" listening mode to NoteWriter. The glasses record and transcribe speech with a minimal blinking-dot display — no transcript or translation shown during recording. Translation happens server-side after the session ends and is available in History.

## Goals

- Minimal distraction on the glasses display during listening (only a recording indicator)
- High-quality transcript and translation available in History after the session
- Reliable: translation completes even if the session is cut short

## Glasses UI — src/glasses/stealth.ts

New file, structurally similar to `listen.ts`.

### States

- `active` — recording, STT connected, audio flowing
- `paused` — audio and STT paused, waiting for user action

### Display

- **Active:** single line alternating `●` / ` ` every 500ms via `setMenuContent`. Nothing else on screen.
- **Paused:** single line showing `‖`. Nothing else on screen.

### Controls

| Event | Active state | Paused state |
|-------|-------------|-------------|
| Click (0) | → paused: `audioControl(false)`, STT disconnect | → active: reconnect STT, `audioControl(true)` |
| Double-click (3) | fire-and-forget `api.finalizeSession(sessionId)`, then `onBack()` | fire-and-forget `api.finalizeSession(sessionId)`, then `onBack()` |

Double-click exits from **any** state (same behaviour as Listen). This is intentional — the user accepting accidental exits in exchange for a simpler interaction model.

If STT reconnect fails on resume, show a brief error line (e.g. `! Error\nClick retry`) and stay in paused state, mirroring Listen's error recovery pattern.

### STT Configuration

Same as Listen (`scribe_v2_realtime`, PCM 16000, VAD commit strategy) with one change:
- `vad_silence_threshold_secs: '1.5'` (string, matches existing SDK usage) vs `'0.5'` in Listen — larger chunks, better transcription quality

### Session Handling

- Create session with `mode: 'stealth'`
- On each `committedTranscript`: call `api.appendParagraph(sessionId, text, '')` — save original only, no translation
- No translation during the session

### Exports

`stealth.ts` exports:
- `startStealth(bridge, api)` — entry point
- `handleStealthEvent(bridge, eventType, api, onBack)` — button/gesture handler
- `handleStealthAudio(pcmData)` — audio packet handler (checks internal state, ignores packets when paused)
- `resetStealth()` — full teardown, called by `resetAll()` in main.ts

## Menu — src/glasses/menu.ts

Insert `'Stealth'` as the second item:

```
['Listen', 'Stealth', 'Dialogue', 'Notes', 'History', 'Settings']
```

- Stealth requires `keysConfigured` (same as Listen); shows `(setup keys first)` otherwise
- All `case` indices in `handleMenuEvent` shift by 1 for items after Listen

## main.ts

Add `onStealth` callback in `handleMenuEvent` call. Wire up:
- `startStealth(bridge, api)` on menu select
- `handleStealthEvent(bridge, eventType, api, onBack)` on bridge events
- Audio routing: the bridge `onAudioData` handler calls `handleAudioData` (Listen) **and** `handleStealthAudio` (Stealth) unconditionally — each handler's internal state guard ignores packets when its mode is inactive. This is the existing pattern; do NOT use `appState.currentScreen` for routing.
- Add `resetStealth()` to the existing `resetAll()` function alongside `resetListen()` and `resetDialogue()`

## Types to update

### src/services/state.ts — `Screen` union type

Add `'stealth'` to the `Screen` type so `appState.navigateTo('stealth')` compiles.

### worker/src/sessions.ts — `Session` interface

Add `mode: string` field so the finalize handler can read it from the DB row.

## Worker — POST /api/sessions/:id/finalize

New route in the Cloudflare Worker (`index.ts`).

**Routing:** Add a specific regex **before** the general `sessionMatch`:
```ts
const finalizeMatch = path.match(/^\/api\/sessions\/([^/]+)\/finalize$/)
if (finalizeMatch && request.method === 'POST') { ... }
```

**Request:** `POST /api/sessions/:id/finalize` (auth required, body empty)

**Response:** `200 {}` immediately

**Background work (ctx.waitUntil):**
1. Verify session exists and belongs to `deviceId` — return 404 if not
2. Return `200 {}` to client
3. Inside `waitUntil`: fetch all paragraphs where `translation = ''`
4. Fetch user settings (`translate_provider`, `translate_model`) and API keys from KV
5. If keys are missing, write a log entry and exit — no silent failure
6. For each paragraph, call `translateText` (Amazon) or `translateWithOpenAI` (OpenAI) based on settings
7. Save each result via `updateParagraphTranslation`
8. Per-paragraph errors are logged and skipped — partial success is acceptable; re-calling finalize is safe because the `WHERE translation = ''` filter skips already-translated paragraphs

**Race condition note:** Client fires `appendParagraph` then `finalizeSession` sequentially. The finalize HTTP call is fire-and-forget (client doesn't await), so both may be in-flight simultaneously. The `WHERE translation = ''` fetch in the background task may run before the last `appendParagraph` commits. Mitigation: the late-arriving paragraph simply has no translation in that finalize run. The user can trigger a second finalize by opening and immediately closing Stealth again if needed. This edge case affects at most the last 1–2 paragraphs and is acceptable.

## ApiClient — src/services/api.ts

Add one method:

```ts
async finalizeSession(id: string): Promise<void> {
  await this.request<{}>(`/api/sessions/${id}/finalize`, { method: 'POST' })
}
```

(`request<{}>` not `request<void>` — `request` always calls `.json()` internally.)

## Phone UI — src/phone/index.html

Add two higher-quality translation models to the existing OpenAI model selector (`#keys-translate-model`):

- `gpt-4.1` — GPT-4.1
- `o4-mini` — O4 Mini

No other phone UI changes needed.

## History

No changes to History display logic. `formatHistoryDetail` already handles empty translations gracefully — paragraphs with no translation show only the original text. Once finalize completes (seconds after session ends), refreshing History shows the translations.

## Out of Scope

- Batch translation API endpoint (single-paragraph translation reused per-paragraph in finalize)
- Auto-translate on History read
- Separate Stealth-specific translation model setting (uses global settings)
- Phone UI indicator for in-progress server translation
