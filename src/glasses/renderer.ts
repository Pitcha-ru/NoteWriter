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
    .map((item, i) => (i === selectedIndex ? `> ${item}` : `  ${item}`))
    .join('\n')
}
