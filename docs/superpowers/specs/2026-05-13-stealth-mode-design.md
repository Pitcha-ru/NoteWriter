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
| Double-click (3) | call `api.finalizeSession(sessionId)` (fire-and-forget), then `onBack()` — same as paused state | call `api.finalizeSession(sessionId)` (fire-and-forget), then `onBack()` |

### STT Configuration

Same as Listen (`scribe_v2_realtime`, PCM 16000, VAD commit strategy) with one change:
- `vad_silence_threshold_secs: '1.5'` (vs `0.5` in Listen) — larger chunks, better transcription quality

### Session Handling

- Create session with `mode: 'stealth'`
- On each `committedTranscript`: call `api.appendParagraph(sessionId, text, '')` — save original only, no translation
- No translation during the session

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
- `handleStealthAudio(pcmData)` exported from `stealth.ts` — separate from Listen's `handleAudioData`, main.ts routes audio to whichever mode is active based on `appState.currentPage`

## Worker — POST /api/sessions/:id/finalize

New route in the Cloudflare Worker.

**Request:** `POST /api/sessions/:id/finalize` (auth required, body empty)

**Response:** `200 {}` immediately

**Background work (ctx.waitUntil):**
1. Fetch all paragraphs for the session where translation is empty
2. Fetch user settings to determine `translate_provider` and `translate_model`
3. Fetch user API keys from KV
4. For each paragraph, call `translateText` (Amazon) or `translateWithOpenAI` (OpenAI) based on settings
5. Save each result via `updateParagraphTranslation`
6. Errors per-paragraph are logged and skipped — partial success is acceptable

## ApiClient — src/services/api.ts

Add one method:

```ts
async finalizeSession(id: string): Promise<void> {
  await this.request(`/api/sessions/${id}/finalize`, { method: 'POST' })
}
```

## Phone UI — src/phone/index.html

Add two higher-quality translation models to the OpenAI model selector:

- `gpt-4.1` — GPT-4.1
- `o4-mini` — O4 Mini

No other phone UI changes needed.

## History

No changes to History display logic. Existing `formatHistoryDetail` pagination already keeps original and translation paired per paragraph per page.

## Out of Scope

- Batch translation API endpoint (single-paragraph translation reused per-paragraph in finalize)
- Auto-translate on History read
- Separate Stealth-specific translation model setting (uses global settings)
- Phone UI indicator for in-progress server translation
