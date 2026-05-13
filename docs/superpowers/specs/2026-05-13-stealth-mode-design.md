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
| Click (0) | → paused: `audioControl(false)`, STT disconnect | → active: fetch fresh STT token, reconnect STT, `audioControl(true)` |
| Double-click (3) | await saveQueue drain, fire-and-forget `api.finalizeSession(sessionId)`, then `onBack()` | same |

Double-click exits from **any** state (same behaviour as Listen). Intentional — simpler interaction model.

If STT reconnect fails on resume, show `! Error\nClick retry` and stay paused — mirroring Listen's error recovery.

### STT Configuration

Same as Listen (`scribe_v2_realtime`, PCM 16000, VAD commit strategy) with one change:
- `vad_silence_threshold_secs: '1.5'` (string, matches existing SDK usage) vs `'0.5'` in Listen — larger chunks, better transcription quality

### Session Handling

- Create session with `mode: 'stealth'`
- Dispatch `notewriter:session-created` after session creation (same as Listen — phone UI needs this to refresh)
- Use `saveQueue` / `enqueueSave` pattern (same as `listen.ts`) — ensures paragraphs are written to the server in order
- On each `committedTranscript`: filter with `isNoise()` (same as Listen — discard `(applause)`, `[music]`, etc.), then enqueue `api.appendParagraph(sessionId, text, '')` — original only, no translation
- Dispatch `notewriter:session-updated` after each successful paragraph save (same as Listen)
- No translation during the session

### Exports

`stealth.ts` exports:
- `startStealth(bridge, api)` — entry point
- `handleStealthEvent(bridge, eventType, api, onBack)` — button/gesture handler
- `handleStealthAudio(pcmData)` — audio packet handler; must guard with `if (stealthState !== 'active') return` at the top
- `resetStealth()` — full teardown: stop indicator timer, call `audioControl(false)`, disconnect STT, set `appState.currentSessionId = null`. Called by `resetAll()` in main.ts.

## Menu — src/glasses/menu.ts

Insert `'Stealth'` as the second item:

```
['Listen', 'Stealth', 'Dialogue', 'Notes', 'History', 'Settings']
```

**Guard:** Stealth requires `keysConfigured` (same as Listen — ElevenLabs + translate keys required, since translate runs server-side at session end). Shows `(setup keys first)` otherwise.

**Index shift** — update `handleMenuEvent` cases:

| Index | Item | Guard |
|-------|------|-------|
| 0 | Listen | `keysConfigured` |
| 1 | Stealth | `keysConfigured` |
| 2 | Dialogue | `keysConfigured && openaiKeyConfigured` |
| 3 | Notes | none |
| 4 | History | none |
| 5 | Settings | none |

Note: index 1 previously was Dialogue (`keysConfigured && openaiKeyConfigured`). The new case 1 guard is `keysConfigured` only.

**Callback type:** Add `onStealth: () => void` to the `callbacks` inline type in `handleMenuEvent`'s signature in `menu.ts`.

## main.ts

- Wrap `startStealth` call in `navigateWithGuard(...)` — same as all other mode transitions; without it, ghost-click suppression doesn't fire
- Add `onStealth: () => navigateWithGuard(() => startStealth(bridge, api))` to the `handleMenuEvent` callbacks object
- Audio routing: call `handleStealthAudio(pcmData)` unconditionally alongside `handleAudioData` — each handler guards itself internally
- Add `resetStealth()` to `resetAll()`
- Add `case 'stealth': handleStealthEvent(...); break` to the `switch (appState.currentScreen)` block

## Types to update

### src/services/state.ts — `Screen` union type
Add `'stealth'` so `appState.navigateTo('stealth')` compiles.

### worker/src/sessions.ts — `Session` interface
Add `mode: string` field so the finalize handler can read the session row at the TypeScript level.

## Worker — POST /api/sessions/:id/finalize

New route in `worker/src/index.ts`.

**Routing:** Add a specific regex **before** the general `sessionMatch` block:
```ts
const finalizeMatch = path.match(/^\/api\/sessions\/([^/]+)\/finalize$/)
if (finalizeMatch && request.method === 'POST') { ... }
```

**Request:** `POST /api/sessions/:id/finalize` (auth required, body empty)

**Synchronous part (before response):**
1. Verify session exists and belongs to `deviceId` — return 404 if not
2. Return `200 {}` immediately

**Background work (ctx.waitUntil) — runs after response is sent:**
3. Fetch all paragraphs where `(translation IS NULL OR translation = '')`
4. Fetch user settings via `getSettings(deviceId, env.DB)` — read `translate_provider` and `translate_model`
5. Fetch API keys via `getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)` (same as translate route)
6. If keys are missing, write a log entry and exit — no silent failure
7. For each paragraph, call `translateText` (Amazon) or `translateWithOpenAI` (OpenAI) based on settings
8. Save each result via `updateParagraphTranslation`
9. Per-paragraph errors are logged and skipped; re-calling finalize is safe (already-translated paragraphs are skipped by the predicate)

**Race condition note:** Client awaits the `saveQueue` before firing `finalizeSession`, minimising the window. Any paragraph that still slips through has no translation in this run; re-calling finalize (open+close Stealth) recovers it. Acceptable edge case.

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

## History

### Glasses History — no changes
`formatHistoryDetail` renders original-only when `translation` is empty. Displays cleanly while finalize is pending.

### Phone History — src/phone/history.ts — one change
`renderParagraph` (lines 172-185) auto-translates paragraphs with empty translations and calls `api.updateParagraphTranslation`. For Stealth sessions opened before finalize completes, this fires N concurrent translate calls from the phone, duplicating finalize work and charging the API key twice.

Fix: skip auto-translate when session mode is `'stealth'`:
```ts
if (!para.translation && para.original && lastSession?.mode !== 'stealth') {
  // existing auto-translate logic
}
```

`lastSession` is set in `openSession` before `renderParagraph` is called — the guard is always evaluated with the correct session. `mode` is returned as-is by the list API (`SELECT *` includes the column; no rename needed via `toCamel`). The client `Session` type in `types.ts` already has `mode?: string`.

## main.ts — switch statement

The `switch (appState.currentScreen)` event-dispatch block needs a `case 'stealth':` branch:
```ts
case 'stealth': handleStealthEvent(bridge, eventType, api, () => navigateWithGuard(() => { resetAll(); showMenu(bridge) })); break
```
Without it, button events on the stealth screen are silently ignored.

## D1 Schema

No new migration needed. The `mode` column was added to `sessions` in `0002_dialogue.sql`. Verify before writing the finalize handler.

## Out of Scope

- Batch translation API endpoint
- Separate Stealth-specific translation model setting (uses global settings)
- Phone UI indicator for in-progress server translation
