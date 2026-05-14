# Listen Mode Quality Improvements — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

## Problem

Listen mode has noticeably worse transcription quality than Stealth mode despite using the same `SttClient` and model. Root causes identified:

1. **Bridge call overload:** `updateDisplay()` is called on every partial transcript (~5-10×/sec), every committed chunk, and every WebSocket status change. Each call triggers `bridge.textContainerUpgrade()` — a synchronous bridge call to native code. This creates backpressure on the WebSocket audio stream, causing ElevenLabs to receive audio with delays and producing poor recognition.

2. **Context-free translation chunks:** `splitIntoChunks(maxLen=120)` splits long committed sentences into fragments. The second fragment ("...and a few more words") is translated without the context of the first part, producing incoherent translations.

## Fix 1: Throttle display updates to 500ms timer

**File:** `src/glasses/listen.ts`

Remove `updateDisplay()` calls from:
- `onPartialTranscript` callback — just store `partialText = text`, no display update
- `onCommittedTranscript` loop — remove the `updateDisplay()` inside the `for` loop
- `onStatus` callback — remove `updateDisplay()` (status is not shown on screen anyway)

The existing 500ms indicator timer already calls `updateDisplay()` every 500ms. This becomes the **sole rendering path** for the glasses display during active listening.

Result: bridge calls drop from ~5-10/sec to 2/sec. The user still sees the current partial phrase updating every 500ms — visually similar to current behaviour but much less load on the WebSocket pipeline.

**Keep `updateDisplay()` in:**
- `pauseListening()` — immediate paused state render
- `resumeListening()` — immediate active state render after reconnect
- The initial `updateDisplay()` call in `startListening` after `startIndicator()`
- The `updateDisplay()` inside translation `.then()` handler — fires once per commit when translation arrives, not frequent, needed to show translation immediately in the bottom half

## Fix 2: Remove `splitIntoChunks` — translate full committed text

**File:** `src/glasses/listen.ts`

Remove the `splitIntoChunks` call from `onCommittedTranscript`. The entire committed text becomes one entry in `committedPairs` and one DB paragraph, regardless of length.

**Before:**
```ts
const chunks = splitIntoChunks(text)
for (const chunk of chunks) {
  committedPairs.push({ original: chunk, translation: '' })
  // save + translate each chunk in parallel
}
```

**After:**
```ts
// No split — full committed text as one unit
committedPairs.push({ original: text, translation: '' })
// save + translate once
```

Same pattern applies in `resumeListening()` — remove split there too.

The `splitIntoChunks` function can be deleted entirely.

## What does NOT change

- `SttClient` configuration (`vad_silence_threshold_secs`, model, language) — unchanged
- Save queue / `enqueueSave` pattern — unchanged
- Translation logic (parallel translate + `updateParagraphTranslation`) — unchanged
- Split-screen layout (top transcript / bottom translation) — unchanged
- Pause/resume/exit flow — unchanged
- `isNoise()` filtering — unchanged

## Expected outcome

- Transcription quality improves (fewer dropped audio frames due to bridge backpressure)
- Translations are coherent (full sentence context instead of fragments)
- Partial text still visible, updating every 500ms — no noticeable UX regression
