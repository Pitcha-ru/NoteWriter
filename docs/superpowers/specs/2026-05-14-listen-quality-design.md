# Listen Mode Quality Improvements — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

## Problem

Listen mode has noticeably worse transcription quality than Stealth mode despite using the same `SttClient` and model. Root causes identified:

1. **Bridge call overload:** `updateDisplay()` is called on every partial transcript (~5-10×/sec), every committed chunk, and every WebSocket status change. Each call triggers `bridge.textContainerUpgrade()` — a synchronous bridge call to native code. This creates backpressure on the WebSocket audio stream, causing ElevenLabs to receive audio with delays and producing poor recognition.

2. **Context-free translation chunks:** `splitIntoChunks(maxLen=120)` splits long committed sentences into fragments. The second fragment is translated without context of the first, producing incoherent translations.

3. **Long paragraph invisible on live display:** Without splitting, ElevenLabs can commit 300-400 char chunks. `fitToLines` in `renderer.ts` counts a 400-char entry as ~11 display lines, exceeds `maxLines=4`, and **skips the entry entirely** — the committed text becomes invisible on screen.

---

## Fix 1: Throttle display updates to 500ms timer

**File:** `src/glasses/listen.ts`  
**Applies to BOTH `startListening` and `resumeListening`**

Remove `updateDisplay()` calls from:
- `onPartialTranscript` callback in both functions — just store `partialText = text`, no display update
- `onCommittedTranscript` loop in both functions — remove the `updateDisplay()` inside the `for (const chunk of chunks)` / after the push
- `onStatus` callback in `startListening` (already absent in `resumeListening`)

The existing 500ms indicator timer calls `updateDisplay()` every 500ms. This becomes the **sole rendering path** during active listening.

**Keep `updateDisplay()` in:**
- `pauseListening()` — immediate paused state render
- `resumeListening()` after `startIndicator()` — initial active render after reconnect
- The initial `updateDisplay()` call in `startListening` after `startIndicator()`
- The `updateDisplay()` inside translation `.then()` handler — fires once per commit when translation arrives, needed to show translation immediately in the bottom half

---

## Fix 2: Remove `splitIntoChunks` — translate full committed text

**File:** `src/glasses/listen.ts`  
**Applies to BOTH `startListening` and `resumeListening`**

Remove the `splitIntoChunks` call. The entire committed text becomes one entry in `committedPairs` and one DB paragraph.

**Before (both functions):**
```ts
const chunks = splitIntoChunks(text)
for (const chunk of chunks) {
  committedPairs.push({ original: chunk, translation: '' })
  log(...)
  updateDisplay()
  // save + translate each chunk
}
```

**After (both functions):**
```ts
const idx = committedPairs.length
committedPairs.push({ original: text, translation: '' })
log('STT', `Committed for translation: "${text.slice(0, 60)}" ${sourceLang}>${targetLang}`)
// save + translate once (same save/translate logic, just not in a loop)
```

The `splitIntoChunks` function in `listen.ts` can be **removed from listen.ts only**. `dialogue.ts` has its own independent copy — leave it untouched.

**Also fix in `resumeListening`:** after a successful `appendParagraph`, dispatch `notewriter:session-updated` — this event is already present in `startListening` but was missing from `resumeListening`. Fix it while modifying both functions.

---

## Fix 3: Handle long paragraphs in live display

**File:** `src/glasses/renderer.ts`

`fitToLines` currently skips any entry whose estimated line count exceeds `maxLines`. With 300-400 char commits, these are skipped entirely, making the committed text invisible.

The display path is: `buildTranscriptText()` → `updateTop(bridge, text)` → `fitToLines(text, HALF_DISPLAY_LINES)`. The bug is in `fitToLines`.

Fix: when the current entry is too long to fit completely but there is remaining display space, truncate it to show its tail instead of skipping it entirely. Remove the `fitted.length === 0` guard — without it, a long entry sitting above a short partial text entry is also handled correctly (the common real-world case).

```ts
function fitToLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  const fitted: string[] = []
  let usedLines = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const lc = Math.max(1, Math.ceil(lines[i].length / CHARS_PER_LINE))
    if (usedLines + lc > maxLines) {
      const remaining = maxLines - usedLines
      if (remaining > 0) {
        fitted.unshift(lines[i].slice(-(remaining * CHARS_PER_LINE)))
      }
      break
    }
    fitted.unshift(lines[i])
    usedLines += lc
  }
  return fitted.join('\n')
}
```

Showing the **tail** (most recent characters) is correct for live transcript display — the newest words are most relevant. This is backward-compatible — short lines behave identically to before.

---

## What does NOT change

- `SttClient` configuration — unchanged
- Save queue / `enqueueSave` pattern — unchanged
- Translation logic (parallel translate + `updateParagraphTranslation`) — unchanged
- Split-screen layout (top transcript / bottom translation) — unchanged
- Pause/resume/exit flow — unchanged
- `isNoise()` filtering — unchanged
- `dialogue.ts` — unchanged (has its own independent `splitIntoChunks` copy)

---

## Expected outcome

- Transcription quality improves (5-10× fewer bridge calls during audio streaming)
- Translations are coherent (full sentence context)
- Long committed text visible on live display (truncated to fit, not invisible)
- Partial text still visible every 500ms — no noticeable UX regression
