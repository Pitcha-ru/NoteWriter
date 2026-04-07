// src/glasses/renderer.ts
// NOTE: The actual SDK types may differ - use 'any' for bridge parameter types since we can't
// verify exact SDK API without hardware. These are best-effort based on documentation.

export interface TextDisplayConfig {
  text: string
  xPosition?: number
  yPosition?: number
  width?: number
  height?: number
  isEventCapture?: boolean
}

export function createTextPage(bridge: any, configs: TextDisplayConfig[]): void {
  const containers = configs.map((c, i) => ({
    type: 'text' as const,
    properties: {
      xPosition: c.xPosition ?? 0,
      yPosition: c.yPosition ?? 0,
      width: c.width ?? 576,
      height: c.height ?? 288,
      text: c.text,
      isEventCapture: c.isEventCapture ? 1 : 0,
    },
    id: i,
  }))
  bridge.createStartUpPageContainer(containers)
}

export function updateText(bridge: any, containerId: number, text: string): void {
  const truncated = text.length > 2000 ? text.slice(-2000) : text
  bridge.textContainerUpgrade(containerId, { text: truncated })
}

export interface ListItem { text: string }

export function createListPage(bridge: any, items: ListItem[], eventCaptureId = 0): void {
  const container = {
    type: 'list' as const,
    properties: {
      items: items.map(item => ({ text: item.text.slice(0, 64) })),
      isEventCapture: 1,
    },
    id: eventCaptureId,
  }
  bridge.createStartUpPageContainer([container])
}

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
