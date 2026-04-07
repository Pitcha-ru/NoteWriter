// src/glasses/history.ts
import { setPageContent, formatHistoryDetail } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Session, Paragraph } from '../types'

function formatDateShort(dateStr: string | undefined): string {
  if (!dateStr) return '?'
  try {
    // D1 returns "2026-04-07 16:20:00" — add T and Z for proper parsing
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return dateStr.slice(0, 16)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return dateStr.slice(0, 16)
  }
}

let sessions: Session[] = []
let paragraphs: Paragraph[] = []
let currentParagraphIndex = 0

export async function showHistoryList(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('history_list')
  sessions = []

  try {
    const response = await api.listSessions()
    sessions = response.sessions

    if (sessions.length === 0) {
      setPageContent(bridge, 'No recordings yet.\nDouble-click to go back.')
    } else {
      const lines = sessions.map((s, i) => {
        const dateStr = formatDateShort(s.createdAt)
        const preview = s.preview ? s.preview.slice(0, 40) : '(empty)'
        return `${i + 1}. ${dateStr}: ${preview}`
      })
      setPageContent(bridge, lines.join('\n'))
    }
  } catch {
    setPageContent(bridge, 'Failed to load history.\nDouble-click to go back.')
  }
}

export async function showSessionDetail(bridge: any, api: ApiClient, sessionIndex: number): Promise<void> {
  appState.navigateTo('history_detail')
  paragraphs = []
  currentParagraphIndex = 0

  const session = sessions[sessionIndex]
  if (!session) {
    setPageContent(bridge, 'Session not found.\nDouble-click to go back.')
    return
  }

  try {
    const response = await api.getSession(session.id)
    paragraphs = response.paragraphs

    if (paragraphs.length === 0) {
      setPageContent(bridge, 'No content in this session.\nDouble-click to go back.')
    } else {
      renderParagraph(bridge)
    }
  } catch {
    setPageContent(bridge, 'Failed to load session.\nDouble-click to go back.')
  }
}

function renderParagraph(bridge: any): void {
  const text = formatHistoryDetail(paragraphs, currentParagraphIndex)
  const indicator = `${currentParagraphIndex + 1}/${paragraphs.length}`
  setPageContent(bridge, `${indicator}\n\n${text}`)
}

export function handleHistoryListEvent(
  bridge: any,
  eventType: number,
  selectedIndex: number,
  api: ApiClient,
  onBack: () => void
): void {
  if (eventType === 3) { // DOUBLE_CLICK — back to menu
    onBack()
    return
  }
  if (eventType === 0) { // CLICK — open session (selectedIndex from list event, fallback unused here)
    if (sessions.length > 0 && selectedIndex < sessions.length) {
      showSessionDetail(bridge, api, selectedIndex)
    }
  }
}

export function handleHistoryDetailEvent(
  bridge: any,
  eventType: number,
  api: ApiClient,
  onBack: () => void
): void {
  switch (eventType) {
    case 3: // DOUBLE_CLICK — back to list
      onBack()
      break
    case 1: // SCROLL_TOP — previous paragraph
      if (currentParagraphIndex > 0) {
        currentParagraphIndex--
        renderParagraph(bridge)
      }
      break
    case 2: // SCROLL_BOTTOM — next paragraph
      if (currentParagraphIndex < paragraphs.length - 1) {
        currentParagraphIndex++
        renderParagraph(bridge)
      }
      break
  }
}
