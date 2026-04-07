// src/glasses/history.ts
import { setPageContent, updateText, formatHistoryDetail } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Session, Paragraph } from '../types'

const DISPLAY_ID = 0

function formatDateShort(dateStr: string | undefined): string {
  if (!dateStr) return '?'
  try {
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return dateStr.slice(0, 16)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return dateStr.slice(0, 16)
  }
}

let sessions: Session[] = []
let listCursorIndex = 0
let paragraphs: Paragraph[] = []
let currentParagraphIndex = 0

// ── History list (with cursor navigation) ────────────────────────────────────

function renderHistoryList(bridge: any): void {
  if (sessions.length === 0) {
    setPageContent(bridge, 'No recordings yet.\nDouble-click to go back.')
    return
  }

  const lines = sessions.map((s, i) => {
    const cursor = i === listCursorIndex ? '> ' : '  '
    const dateStr = formatDateShort(s.createdAt)
    const preview = s.preview ? s.preview.slice(0, 35) : '(empty)'
    return `${cursor}${dateStr} ${preview}`
  })
  updateText(bridge, DISPLAY_ID, lines.join('\n'))
}

export async function showHistoryList(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('history_list')
  sessions = []
  listCursorIndex = 0

  setPageContent(bridge, 'Loading...')

  try {
    const response = await api.listSessions()
    sessions = response.sessions
    renderHistoryList(bridge)
  } catch {
    updateText(bridge, DISPLAY_ID, 'Failed to load history.\nDouble-click to go back.')
  }
}

export function handleHistoryListEvent(
  bridge: any,
  eventType: number,
  _selectedIndex: number,
  api: ApiClient,
  onBack: () => void
): void {
  if (eventType === 3) { // DOUBLE_CLICK — back to menu
    onBack()
    return
  }
  if (eventType === 1) { // UP — move cursor up
    if (listCursorIndex > 0) {
      listCursorIndex--
      renderHistoryList(bridge)
    }
    return
  }
  if (eventType === 2) { // DOWN — move cursor down
    if (listCursorIndex < sessions.length - 1) {
      listCursorIndex++
      renderHistoryList(bridge)
    }
    return
  }
  if (eventType === 0) { // CLICK — open selected session
    if (sessions.length > 0 && listCursorIndex < sessions.length) {
      showSessionDetail(bridge, api, listCursorIndex)
    }
  }
}

// ── Session detail (scroll through paragraphs) ──────────────────────────────

let lastShown = 1 // how many paragraphs were shown on last render

function renderParagraph(bridge: any): void {
  const { text, shown } = formatHistoryDetail(paragraphs, currentParagraphIndex)
  lastShown = Math.max(shown, 1)
  const endIdx = Math.min(currentParagraphIndex + lastShown, paragraphs.length)
  const indicator = `${currentParagraphIndex + 1}-${endIdx}/${paragraphs.length}`
  updateText(bridge, DISPLAY_ID, `${indicator}\n${text}`)
}

export async function showSessionDetail(bridge: any, api: ApiClient, sessionIndex: number): Promise<void> {
  appState.navigateTo('history_detail')
  paragraphs = []
  currentParagraphIndex = 0

  const session = sessions[sessionIndex]
  if (!session) {
    updateText(bridge, DISPLAY_ID, 'Session not found.\nDouble-click to go back.')
    return
  }

  updateText(bridge, DISPLAY_ID, 'Loading...')

  try {
    const response = await api.getSession(session.id)
    paragraphs = response.paragraphs

    if (paragraphs.length === 0) {
      updateText(bridge, DISPLAY_ID, 'No content in this session.\nDouble-click to go back.')
    } else {
      renderParagraph(bridge)
    }
  } catch {
    updateText(bridge, DISPLAY_ID, 'Failed to load session.\nDouble-click to go back.')
  }
}

export function handleHistoryDetailEvent(
  bridge: any,
  eventType: number,
  _api: ApiClient,
  onBack: () => void
): void {
  switch (eventType) {
    case 3: // DOUBLE_CLICK — back to list
      onBack()
      break
    case 1: // UP — previous page
      if (currentParagraphIndex > 0) {
        currentParagraphIndex = Math.max(0, currentParagraphIndex - lastShown)
        renderParagraph(bridge)
      }
      break
    case 2: // DOWN — next page
      if (currentParagraphIndex + lastShown < paragraphs.length) {
        currentParagraphIndex += lastShown
        renderParagraph(bridge)
      }
      break
  }
}
