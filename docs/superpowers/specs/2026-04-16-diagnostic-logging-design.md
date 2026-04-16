# Diagnostic Logging for NoteWriter

## Problem

During device testing, parts of transcripts are lost and translations are missing from history. The app has almost no logging — errors are silently swallowed via `.catch(() => {})`. There is no way to understand what happened after the fact.

## Solution

Add a lightweight client-side logger that records critical pipeline events, stored in localStorage, downloadable as a text file from the phone Settings UI.

## Logger Service (`src/services/logger.ts`)

A singleton module that stores log entries in memory and mirrors them to `localStorage['notewriter:log']`.

### Entry format

```
[YYYY-MM-DD HH:MM:SS.mmm] [TAG] message
```

Tags: `STT`, `TRANSLATE`, `SAVE`, `DIALOGUE`, `SESSION`, `ERR`

### API

- `log(tag: string, message: string): void` — append entry with auto-timestamp, persist to localStorage
- `download(): void` — create and download a `notewriter-log-YYYY-MM-DD.txt` file via Blob + `<a download>`
- `clear(): void` — wipe all entries from memory and localStorage
- `getEntries(): string[]` — return all entries (for display/debug)

### Storage

- On init: load existing entries from localStorage (if any)
- On each `log()`: push to array, write full array to localStorage
- No automatic size limit; user controls via Clear button

## Instrumentation Points

### STT (`src/services/stt.ts`)

| Event | Log |
|-------|-----|
| WebSocket open | `[STT] WebSocket connected` |
| WebSocket close | `[STT] WebSocket closed: {code}` |
| WebSocket error | `[ERR] STT WebSocket error` |
| Session started | `[STT] Session started` |
| Partial transcript | `[STT] Partial transcript (len={n})` |
| Committed transcript | `[STT] Committed: "{text}" (len={n})` |
| Reconnect | `[STT] Reconnecting (attempt {n}/{max})` |
| Parse error | `[ERR] STT message parse error` |

### Listen (`src/glasses/listen.ts`)

| Event | Log |
|-------|-----|
| Session created | `[SESSION] Created id={id}, {listenLang}>{translateLang}` |
| Chunk to translate | `[TRANSLATE] Request: "{chunk}" {src}>{tgt}` |
| Translation received | `[TRANSLATE] Response: "{translation}" ({ms}ms)` |
| Translation failed | `[ERR] Translation failed: {error}` |
| Paragraph saved | `[SAVE] Paragraph saved id={id}` |
| Paragraph save failed | `[ERR] Paragraph save failed: {error}` |
| Translation update failed | `[ERR] Translation update failed: {error}` |
| Pause | `[SESSION] Paused` |
| Resume | `[SESSION] Resumed` |
| Start listening | `[SESSION] Start listening` |
| Stop/exit | `[SESSION] Stopped` |

### Dialogue (`src/glasses/dialogue.ts`)

| Event | Log |
|-------|-----|
| Dialogue request sent | `[DIALOGUE] Request sent (messages={n})` |
| Dialogue response received | `[DIALOGUE] Response received ({ms}ms)` |
| Dialogue error | `[ERR] Dialogue failed: {error}` |

## What We Do NOT Log

- Individual audio packets (thousands per second)
- Full text of partial transcripts (only length)
- Any sensitive data (API keys, tokens)
- Anything on the glasses UI

## Phone Settings UI

Below the "Save Settings" button, add a subtle link:

```
[Save Settings]

                                    Log file >
```

- Style: 12px, color #8e8e93, right-aligned or centered, cursor pointer
- On click: expand an inline block with two small buttons:
  - `Download log` (btn-secondary btn-sm)
  - `Clear log` (btn-sm, muted text style)
- Download filename: `notewriter-log-YYYY-MM-DD.txt`
- After clear: show toast "Log cleared"
- After download with empty log: show toast "Log is empty"

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/logger.ts` | Create — logger service |
| `src/services/stt.ts` | Modify — add log calls |
| `src/glasses/listen.ts` | Modify — add log calls, replace silent catches |
| `src/glasses/dialogue.ts` | Modify — add log calls |
| `src/phone/index.html` | Modify — add log UI to settings panel |
| `src/phone/settings.ts` | Modify — wire up download/clear buttons |
