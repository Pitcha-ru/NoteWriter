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
  currentLayout = null
}

/**
 * Display/update a text page on the glasses.
 * First call uses createStartUpPageContainer; all subsequent calls use rebuildPageContainer.
 * Never resets — createStartUpPageContainer is called only once per app lifecycle.
 */
// Track current layout mode so we only rebuild when switching layouts
let currentLayout: 'menu' | 'single' | 'split' | null = null

/**
 * Menu-only layout: 2 containers — visible content (no scroll) + invisible event catcher.
 * Prevents native scroll jitter when navigating menu with UP/DOWN.
 */
export function setMenuContent(bridge: any, content: string): void {
  const truncated = content.length > 2000 ? content.slice(-2000) : content
  const contentProp = new TextContainerProperty({
    containerID: 0,
    content: truncated,
    isEventCapture: 0,
    width: 576,
    height: 280,
    xPosition: 0,
    yPosition: 0,
  })
  const eventProp = new TextContainerProperty({
    containerID: 1,
    content: '',
    isEventCapture: 1,
    width: 1,
    height: 1,
    xPosition: 575,
    yPosition: 287,
  })

  if (!pageCreated) {
    pageCreated = true
    currentLayout = 'menu'
    bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 2,
        textObject: [contentProp, eventProp],
      })
    )
  } else if (currentLayout !== 'menu') {
    currentLayout = 'menu'
    bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 2,
        textObject: [contentProp, eventProp],
      })
    )
  } else {
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 0, content: truncated })
    )
  }
}

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
    currentLayout = 'single'
    bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [textProp],
      })
    )
  } else if (currentLayout !== 'single') {
    currentLayout = 'single'
    bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [textProp],
      })
    )
  } else {
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 0, content: truncated })
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
    currentLayout = 'split'
    bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 2,
        textObject: [topProp, bottomProp],
      })
    )
  } else if (currentLayout !== 'split') {
    currentLayout = 'split'
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

// Lines available for content (1 reserved for page indicator)
const CONTENT_LINES = MAX_DISPLAY_LINES - 1 // 8
// Lines per half-screen (orig / trans split)
const HALF_LINES = Math.floor(CONTENT_LINES / 2) // 4

/**
 * Build a flat list of screen-sized pages from all paragraphs in a session.
 * Each page fits on one screen. Text breaks at sentence boundaries where possible;
 * only breaks mid-sentence when a single sentence exceeds the half-screen limit.
 */
export function buildHistoryPages(
  paragraphs: Array<{ original: string; translation: string }>
): string[] {
  const pages: string[] = []
  for (const para of paragraphs) {
    const origWindows = splitToWindows(para.original, HALF_LINES)
    const transWindows = para.translation ? splitToWindows(para.translation, HALF_LINES) : []
    const count = Math.max(origWindows.length, transWindows.length)
    if (count === 0) continue // skip empty paragraphs
    for (let i = 0; i < count; i++) {
      const orig = origWindows[i] ?? ''
      const trans = transWindows[i] ?? ''
      pages.push(trans ? `${orig}\n${trans}` : orig)
    }
  }
  return pages
}

// Split text into windows of ≤maxLines display lines, breaking at sentence boundaries.
// Falls back to character-based split only when a single sentence exceeds maxLines.
function splitToWindows(text: string, maxLines: number): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (estimateLines(trimmed) <= maxLines) return [trimmed]

  // Extract sentence-terminated parts + any trailing fragment without punctuation
  const matched = trimmed.match(/[^.!?;]+[.!?;]+\s*/g) ?? []
  const trailing = trimmed.slice(matched.join('').length).trim()
  const sentences = matched.length > 0
    ? (trailing ? [...matched, trailing] : matched)
    : [trimmed]

  const result: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const s = current ? `${current}${sentence}` : sentence.trimStart()
    if (estimateLines(s) > maxLines && current) {
      result.push(current.trim())
      const next = sentence.trimStart()
      if (estimateLines(next) > maxLines) {
        const chunks = splitByChars(next, maxLines)
        result.push(...chunks.slice(0, -1))
        current = chunks[chunks.length - 1] ?? ''
      } else {
        current = next
      }
    } else if (estimateLines(s) > maxLines) {
      const chunks = splitByChars(s.trimStart(), maxLines)
      result.push(...chunks.slice(0, -1))
      current = chunks[chunks.length - 1] ?? ''
    } else {
      current = s
    }
  }
  if (current.trim()) result.push(current.trim())
  return result.filter(w => w.trim().length > 0)
}

function splitByChars(text: string, maxLines: number): string[] {
  const chunkSize = maxLines * CHARS_PER_LINE
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize))
  return chunks
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
