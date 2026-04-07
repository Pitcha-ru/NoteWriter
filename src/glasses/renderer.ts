// src/glasses/renderer.ts
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// Track whether the initial page has been created so we know which bridge call to use.
let pageCreated = false

/** Reset page state — call when navigating away and back in. */
export function resetPageState(): void {
  pageCreated = false
}

/**
 * Display a text page on the glasses.
 * First call uses createStartUpPageContainer; subsequent calls use rebuildPageContainer.
 */
export function createTextPage(bridge: any, content: string): void {
  const textProp = new TextContainerProperty({
    containerID: 0,
    content,
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

export function formatListenDisplay(
  committedPairs: Array<{ original: string; translation: string }>,
  partialText: string
): string {
  const recent = committedPairs.slice(-2)
  const lines: string[] = []
  for (const pair of recent) {
    lines.push(pair.original)
    lines.push(pair.translation)
    lines.push('')
  }
  if (partialText) lines.push(partialText)
  return lines.join('\n')
}

export function formatHistoryDetail(
  paragraphs: Array<{ original: string; translation: string }>,
  currentIndex: number
): string {
  const p = paragraphs[currentIndex]
  if (!p) return ''
  return `${p.original}\n\n${p.translation}`
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
    .map((item, i) => (i === selectedIndex ? `▸ ${item}` : `  ${item}`))
    .join('\n')
}
