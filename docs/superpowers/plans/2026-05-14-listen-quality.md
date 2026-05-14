# Listen Mode Quality Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Listen mode transcription quality by throttling bridge display calls, removing context-breaking chunk splitting, and making `fitToLines` handle long paragraphs correctly.

**Architecture:** Three surgical edits — `renderer.ts` gets a smarter `fitToLines`, `listen.ts` removes `updateDisplay()` from high-frequency callbacks (leaving only the 500ms timer) and removes `splitIntoChunks` so each ElevenLabs commit is one paragraph. No new files, no new interfaces.

**Tech Stack:** TypeScript, Vitest, Even Realities bridge SDK

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `src/glasses/renderer.ts` | Export `fitToLines`; fix truncation for long lines |
| Create | `src/__tests__/glasses/renderer.test.ts` | Tests for `fitToLines` long-line behaviour |
| Modify | `src/glasses/listen.ts` | Remove `updateDisplay()` from partials/status; remove `splitIntoChunks`; add `session-updated` to `resumeListening` |

---

## Task 1: Fix `fitToLines` in renderer.ts

**Files:**
- Modify: `src/glasses/renderer.ts:167-179`
- Create: `src/__tests__/glasses/renderer.test.ts`

- [ ] **Step 1: Export `fitToLines` for testability**

In `src/glasses/renderer.ts`, change line 168 from:
```ts
function fitToLines(text: string, maxLines: number): string {
```
to:
```ts
export function fitToLines(text: string, maxLines: number): string {
```

- [ ] **Step 2: Write failing tests**

Create `src/__tests__/glasses/renderer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fitToLines } from '../../glasses/renderer'

const CPL = 38 // CHARS_PER_LINE used internally

describe('fitToLines', () => {
  it('returns short text unchanged', () => {
    const result = fitToLines('Hello world', 4)
    expect(result).toBe('Hello world')
  })

  it('keeps last N display-lines of multi-line text', () => {
    const lines = ['line1', 'line2', 'line3', 'line4', 'line5']
    const result = fitToLines(lines.join('\n'), 3)
    expect(result).toBe('line3\nline4\nline5')
  })

  it('truncates a single very long line to fit (tail)', () => {
    // 400-char line = ceil(400/38) = 11 display lines — must not be skipped
    const longLine = 'x'.repeat(400)
    const result = fitToLines(longLine, 4)
    // Should show tail: 4 * 38 = 152 chars
    expect(result).toBe(longLine.slice(-152))
    expect(result.length).toBe(152)
  })

  it('shows tail of long committed chunk above a short partial line', () => {
    // Common live display: short partial at bottom, long committed chunk above
    const longCommit = 'a'.repeat(300)  // ceil(300/38)=8 display lines
    const shortPartial = '* hello'        // 1 display line
    const text = `${longCommit}\n${shortPartial}`
    const result = fitToLines(text, 4)
    const resultLines = result.split('\n')
    // shortPartial must be present (fits in 1 line)
    expect(resultLines[resultLines.length - 1]).toBe(shortPartial)
    // longCommit must contribute remaining 3 lines = 3*38=114 chars, not be dropped
    expect(resultLines[0]).toBe(longCommit.slice(-114))
  })

  it('empty text returns empty string', () => {
    expect(fitToLines('', 4)).toBe('')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npm test -- --reporter=verbose 2>&1 | grep -A10 "fitToLines"
```
Expected: 3-4 failures (truncation tests fail with current `break`-only logic).

- [ ] **Step 4: Implement the fix**

In `src/glasses/renderer.ts`, replace the `fitToLines` body (lines 167-179):
```ts
export function fitToLines(text: string, maxLines: number): string {
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

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A10 "fitToLines"
```
Expected: all 5 tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```
Expected: all tests pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/glasses/renderer.ts src/__tests__/glasses/renderer.test.ts
git commit -m "fix: fitToLines truncates long lines to tail instead of dropping them"
```

---

## Task 2: Throttle display + remove splitIntoChunks in listen.ts

**Files:**
- Modify: `src/glasses/listen.ts`

This task rewrites the two STT callback blocks in both `startListening` and `resumeListening`. Read the full current file before making changes.

- [ ] **Step 1: Remove `updateDisplay()` from `onPartialTranscript` in `startListening`**

Find lines 261-265 in `src/glasses/listen.ts`:
```ts
sttClient.onPartialTranscript((text) => {
  if (isNoise(text)) return
  partialText = text
  updateDisplay()
})
```
Change to:
```ts
sttClient.onPartialTranscript((text) => {
  if (isNoise(text)) return
  partialText = text
})
```

- [ ] **Step 2: Remove `updateDisplay()` from `onStatus` in `startListening`**

Find line 315 in `src/glasses/listen.ts`:
```ts
sttClient.onStatus((msg) => { sttStatus = msg; updateDisplay() })
```
Change to:
```ts
sttClient.onStatus((msg) => { sttStatus = msg })
```

- [ ] **Step 3: Replace `onCommittedTranscript` in `startListening` — remove loop and split**

Find lines 267-312 in `src/glasses/listen.ts` (the full `onCommittedTranscript` handler). Replace the entire handler with:
```ts
sttClient.onCommittedTranscript((text) => {
  partialText = ''
  if (isNoise(text)) return

  const idx = committedPairs.length
  const sourceLang = appState.settings.listenLang
  const targetLang = appState.settings.translateLang
  committedPairs.push({ original: text, translation: '' })
  log('STT', `Committed for translation: "${text.slice(0, 60)}" ${sourceLang}>${targetLang}`)

  const savePromise = new Promise<string | null>((resolve) => {
    enqueueSave(async () => {
      const sessionId = appState.currentSessionId
      if (sessionId) {
        try {
          const p = await api.appendParagraph(sessionId, text, '')
          log('SAVE', `Paragraph saved id=${p.id}`)
          window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
          resolve(p.id)
          return
        } catch (e) { log('ERR', `Paragraph save failed: ${e instanceof Error ? e.message : String(e)}`) }
      }
      resolve(null)
    })
  })

  const translateStart = Date.now()
  api.translate(text, sourceLang, targetLang, appState.settings.translateProvider, appState.settings.translateModel)
    .then(async (translated) => {
      if (translated) {
        log('TRANSLATE', `Response: "${translated.slice(0, 60)}" (${Date.now() - translateStart}ms)`)
        committedPairs[idx].translation = translated
        updateDisplay()
        const paraId = await savePromise
        if (paraId) api.updateParagraphTranslation(paraId, translated).catch((e) => { log('ERR', `Translation update failed: ${e instanceof Error ? e.message : String(e)}`) })
      }
    })
    .catch((e) => { log('ERR', `Translation failed: ${e instanceof Error ? e.message : String(e)}`) })
})
```

- [ ] **Step 4: Remove `updateDisplay()` from `onPartialTranscript` in `resumeListening`**

Find lines 160-163 in `src/glasses/listen.ts`:
```ts
sttClient.onPartialTranscript((text) => {
  partialText = text
  updateDisplay()
})
```
Change to:
```ts
sttClient.onPartialTranscript((text) => {
  partialText = text
})
```

- [ ] **Step 5: Replace `onCommittedTranscript` in `resumeListening` — remove loop, split, add session-updated**

Find lines 165-205 in `src/glasses/listen.ts` (the full `onCommittedTranscript` handler inside `resumeListening`). Replace with:
```ts
sttClient.onCommittedTranscript((text) => {
  partialText = ''
  if (isNoise(text)) return

  const idx = committedPairs.length
  const sourceLang = appState.settings.listenLang
  const targetLang = appState.settings.translateLang
  committedPairs.push({ original: text, translation: '' })
  log('STT', `Committed for translation: "${text.slice(0, 60)}" ${sourceLang}>${targetLang}`)

  const saveP = new Promise<string | null>((resolve) => {
    enqueueSave(async () => {
      const sessionId = appState.currentSessionId
      if (sessionId) {
        try {
          const p = await currentApi!.appendParagraph(sessionId, text, '')
          log('SAVE', `Paragraph saved id=${p.id}`)
          window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
          resolve(p.id)
          return
        } catch (e) { log('ERR', `Paragraph save failed: ${e instanceof Error ? e.message : String(e)}`) }
      }
      resolve(null)
    })
  })

  const translateStart = Date.now()
  currentApi!.translate(text, sourceLang, targetLang, appState.settings.translateProvider, appState.settings.translateModel)
    .then(async (translated) => {
      if (translated) {
        log('TRANSLATE', `Response: "${translated.slice(0, 60)}" (${Date.now() - translateStart}ms)`)
        committedPairs[idx].translation = translated
        updateDisplay()
        const paraId = await saveP
        if (paraId) currentApi!.updateParagraphTranslation(paraId, translated).catch((e) => { log('ERR', `Translation update failed: ${e instanceof Error ? e.message : String(e)}`) })
      }
    })
    .catch((e) => { log('ERR', `Translation failed: ${e instanceof Error ? e.message : String(e)}`) })
})
```

- [ ] **Step 6: Delete `splitIntoChunks` function from listen.ts**

Remove lines 38-70 (the entire `splitIntoChunks` function and its comment). Verify `dialogue.ts` is untouched — it has its own copy.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/glasses/listen.ts
git commit -m "fix: listen mode — throttle display to 500ms timer, remove splitIntoChunks, add session-updated to resumeListening"
```

---

## Task 3: Build, bump version, repack

- [ ] **Step 1: Build plugin**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npm run build:plugin
```
Expected: `✓ built in Xms` with no errors.

- [ ] **Step 2: Bump version in app.json**

In `app.json`, increment patch version: `1.8.36` → `1.8.37`.

- [ ] **Step 3: Repack ehpk**

```bash
evenhub pack app.json dist -o notewriter.ehpk
```
Expected: `Successfully packed notewriter.ehpk (XXXXX bytes)`

- [ ] **Step 4: Commit and push**

```bash
git add app.json
git commit -m "chore: bump version to 1.8.37, build Listen quality improvements"
git push
```

---

## Self-Review

| Spec requirement | Covered |
|-----------------|---------|
| Remove `updateDisplay()` from `onPartialTranscript` in `startListening` | Task 2 Step 1 |
| Remove `updateDisplay()` from `onStatus` in `startListening` | Task 2 Step 2 |
| Remove `updateDisplay()` from commit loop in `startListening` | Task 2 Step 3 |
| Remove `updateDisplay()` from `onPartialTranscript` in `resumeListening` | Task 2 Step 4 |
| Remove `updateDisplay()` from commit loop in `resumeListening` | Task 2 Step 5 |
| Keep `updateDisplay()` in translation `.then()` handler | Task 2 Steps 3 & 5 ✓ |
| Keep `updateDisplay()` in `pauseListening`, `startListening` init, `resumeListening` init | Not touched ✓ |
| Remove `splitIntoChunks` from `startListening` | Task 2 Step 3 |
| Remove `splitIntoChunks` from `resumeListening` | Task 2 Step 5 |
| Delete `splitIntoChunks` function from `listen.ts` only | Task 2 Step 6 |
| Add `session-updated` dispatch to `resumeListening` | Task 2 Step 5 |
| Fix `fitToLines` to truncate instead of skip | Task 1 Step 4 |
| `fitToLines` exported for testability | Task 1 Step 1 |
| Tests for `fitToLines` long-line behaviour | Task 1 Step 2 |
| `dialogue.ts` unchanged | Task 2 Step 6 note ✓ |
