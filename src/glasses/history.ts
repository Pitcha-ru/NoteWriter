// src/glasses/history.ts
import { createListPage, createTextPage, updateText, formatHistoryDetail } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Session, Paragraph } from '../types'

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
      createListPage(bridge, [{ text: 'No recordings yet' }])
    } else {
      const items = sessions.map((s) => {
        const date = new Date(s.createdAt).toLocaleDateString()
        const preview = s.preview ? s.preview.slice(0, 40) : '(empty)'
        return { text: `${date}: ${preview}` }
      })
      createListPage(bridge, items)
    }
  } catch {
    createListPage(bridge, [{ text: 'Failed to load history' }])
  }
}

export async function showSessionDetail(bridge: any, api: ApiClient, sessionIndex: number): Promise<void> {
  appState.navigateTo('history_detail')
  paragraphs = []
  currentParagraphIndex = 0

  const session = sessions[sessionIndex]
  if (!session) {
    createTextPage(bridge, [{ text: 'Session not found.\nDouble-click to go back.', isEventCapture: true }])
    return
  }

  try {
    const response = await api.getSession(session.id)
    paragraphs = response.paragraphs

    if (paragraphs.length === 0) {
      createTextPage(bridge, [
        { text: 'No content in this session.\nDouble-click to go back.', isEventCapture: true },
      ])
    } else {
      renderParagraph(bridge)
    }
  } catch {
    createTextPage(bridge, [{ text: 'Failed to load session.\nDouble-click to go back.', isEventCapture: true }])
  }
}

function renderParagraph(bridge: any): void {
  const text = formatHistoryDetail(paragraphs, currentParagraphIndex)
  const indicator = `${currentParagraphIndex + 1}/${paragraphs.length}`
  const display = `${indicator}\n\n${text}`
  createTextPage(bridge, [{ text: display, isEventCapture: true }])
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
  if (eventType === 0) { // CLICK — open session
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
