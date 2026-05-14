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
