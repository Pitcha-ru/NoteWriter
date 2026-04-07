// src/glasses/renderer.ts
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// createStartUpPageContainer must be called exactly ONCE. After that, only rebuildPageContainer.
let pageCreated = false

/**
 * Display/update a text page on the glasses.
 * First call uses createStartUpPageContainer; all subsequent calls use rebuildPageContainer.
 * Never resets — createStartUpPageContainer is called only once per app lifecycle.
 */
export function setPageContent(bridge: any, content: string): void {
  const truncated = content.length > 2000 ? content.slice(-2000) : content
  const textProp = new TextContainerProperty({
    containerID: 0,
    content: truncated,
    isEventCapture: 1,
    width: 576,
    height: 288,
  })

  if (!pageCreated) {
    pageCreated = true
    bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [textProp],
      })
    )
  } else {
    bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [textProp],
      })
    )
  }
}

/**
 * Incrementally update the text of a container that has already been created.
 */
export function updateText(bridge: any, containerId: number, text: string): void {
  const truncated = text.length > 2000 ? text.slice(-2000) : text
  bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: containerId,
      content: truncated,
    })
  )
}

// ── Helpers for formatting display text ───────────────────────────────────────

// Approximate max lines that fit on 576x288 display without scroll
const MAX_DISPLAY_LINES = 9
// Approximate chars per line on the display
const CHARS_PER_LINE = 38

function estimateLines(text: string): number {
  if (!text) return 0
  return text.split('\n').reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0)
}

export function formatListenDisplay(
  committedPairs: Array<{ original: string; translation: string }>,
  partialText: string,
  indicatorDot: string
): string {
  // Build from bottom up: partial text first, then as many committed pairs as fit
  const parts: string[] = []
  let linesUsed = 0

  // Reserve space for partial text + indicator dot on first line
  if (partialText) {
    const partialBlock = `${indicatorDot} ${partialText}`
    linesUsed += estimateLines(partialBlock)
    parts.unshift(partialBlock)
  } else {
    parts.unshift(`${indicatorDot}`)
    linesUsed += 1
  }

  // Add committed pairs from newest to oldest, as many as fit
  for (let i = committedPairs.length - 1; i >= 0; i--) {
    const pair = committedPairs[i]
    const block = pair.translation
      ? `${pair.original}\n${pair.translation}`
      : pair.original
    const blockLines = estimateLines(block) + 1 // +1 for separator line
    if (linesUsed + blockLines > MAX_DISPLAY_LINES) break
    linesUsed += blockLines
    parts.unshift(block)
  }

  return parts.join('\n')
}

/**
 * Show as many paragraphs as fit on screen starting from currentIndex.
 * Returns the formatted text and how many paragraphs were shown.
 */
export function formatHistoryDetail(
  paragraphs: Array<{ original: string; translation: string }>,
  currentIndex: number
): { text: string; shown: number } {
  if (!paragraphs[currentIndex]) return { text: '', shown: 0 }

  const parts: string[] = []
  let linesUsed = 1 // reserve 1 line for page indicator
  let count = 0

  for (let i = currentIndex; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const block = p.translation
      ? `${p.original}\n${p.translation}`
      : p.original
    const blockLines = estimateLines(block) + (parts.length > 0 ? 1 : 0) // +1 separator between blocks
    if (linesUsed + blockLines > MAX_DISPLAY_LINES && count > 0) break
    linesUsed += blockLines
    parts.push(block)
    count++
  }

  return { text: parts.join('\n\n'), shown: count }
}

/**
 * Render a list of items as formatted text with a cursor indicator.
 * Example:
 *   ▸ Listen
 *     History
 *     Settings
 */
export function formatMenuText(items: string[], selectedIndex = 0): string {
  return items
    .map((item, i) => (i === selectedIndex ? `> ${item}` : `  ${item}`))
    .join('\n')
}
