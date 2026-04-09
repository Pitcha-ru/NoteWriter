// src/glasses/renderer.ts
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// createStartUpPageContainer must be called exactly ONCE. After that, only rebuildPageContainer.
// After shutDownPageContainer, reset so next setPageContent calls create again.
let pageCreated = false

export function resetPage(): void {
  pageCreated = false
}

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
 * Switch to split-screen layout: top half for transcript, bottom half for translation.
 * Uses rebuildPageContainer with two text containers.
 */
export function setSplitLayout(bridge: any, topText: string, bottomText: string): void {
  const topProp = new TextContainerProperty({
    containerID: 0,
    content: topText,
    isEventCapture: 1,
    width: 576,
    height: 140,
    xPosition: 0,
    yPosition: 0,
  })
  const bottomProp = new TextContainerProperty({
    containerID: 1,
    content: bottomText,
    isEventCapture: 0,
    width: 576,
    height: 140,
    xPosition: 0,
    yPosition: 148,
  })

  if (!pageCreated) {
    pageCreated = true
    bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 2,
        textObject: [topProp, bottomProp],
      })
    )
  } else {
    bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 2,
        textObject: [topProp, bottomProp],
      })
    )
  }
}

/** Update just the top container (ID 0) — for transcript */
export function updateTop(bridge: any, text: string): void {
  if (!bridge) return
  const content = fitToLines(text, HALF_DISPLAY_LINES)
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 0, content }))
}

/** Update just the bottom container (ID 1) — for translation */
export function updateBottom(bridge: any, text: string): void {
  if (!bridge) return
  const content = fitToLines(text, HALF_DISPLAY_LINES)
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, content }))
}

/** Fit text to N lines, keeping newest (bottom) lines */
function fitToLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  const fitted: string[] = []
  let usedLines = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const lc = Math.max(1, Math.ceil(lines[i].length / CHARS_PER_LINE))
    if (usedLines + lc > maxLines) break
    fitted.unshift(lines[i])
    usedLines += lc
  }
  return fitted.join('\n')
}

/**
 * Incrementally update the text of a container that has already been created.
 * Truncates content to fit on screen to prevent native scroll.
 */
export function updateText(bridge: any, containerId: number, text: string): void {
  // Keep the LAST lines that fit on screen (newest content visible)
  const lines = text.split('\n')
  const fitted: string[] = []
  let usedLines = 0
  // Build from bottom up — keep newest lines
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineCount = Math.max(1, Math.ceil(lines[i].length / CHARS_PER_LINE))
    if (usedLines + lineCount > MAX_DISPLAY_LINES) break
    fitted.unshift(lines[i])
    usedLines += lineCount
  }
  const content = fitted.join('\n')
  const truncated = content.length > 2000 ? content.slice(-2000) : content
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
const HALF_DISPLAY_LINES = 4
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
 * Truncate text to fit within maxLines, breaking at word boundaries.
 */
function truncateToFit(text: string, maxLines: number): string {
  const words = text.split(/\s+/)
  let result = ''
  for (const word of words) {
    const candidate = result ? `${result} ${word}` : word
    if (estimateLines(candidate) > maxLines) break
    result = candidate
  }
  return result || text.slice(0, CHARS_PER_LINE * maxLines)
}

/**
 * Show as many paragraphs as fit on screen starting from currentIndex.
 * Long paragraphs are truncated to fit. Returns formatted text and count shown.
 */
export function formatHistoryDetail(
  paragraphs: Array<{ original: string; translation: string }>,
  currentIndex: number
): { text: string; shown: number } {
  if (!paragraphs[currentIndex]) return { text: '', shown: 0 }

  const maxContent = MAX_DISPLAY_LINES - 1 // reserve 1 line for page indicator
  const parts: string[] = []
  let linesUsed = 0
  let count = 0

  for (let i = currentIndex; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const remaining = maxContent - linesUsed
    if (remaining <= 0 && count > 0) break

    let orig = p.original
    let trans = p.translation

    // If this is the first item and it's long, truncate to fit screen
    const fullBlock = trans ? `${orig}\n${trans}` : orig
    const fullLines = estimateLines(fullBlock) + (count > 0 ? 1 : 0)

    if (linesUsed + fullLines > maxContent) {
      if (count > 0) break // skip if we already have content
      // Truncate first (and only) paragraph to fit
      const linesForOrig = trans ? Math.ceil(remaining / 2) : remaining
      const linesForTrans = remaining - linesForOrig
      orig = truncateToFit(orig, linesForOrig)
      if (trans) trans = truncateToFit(trans, linesForTrans)
    }

    const block = trans ? `${orig}\n${trans}` : orig
    const blockLines = estimateLines(block) + (count > 0 ? 1 : 0)
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
