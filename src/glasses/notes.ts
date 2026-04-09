// src/glasses/notes.ts
import { setPageContent, updateText, formatHistoryDetail } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Note } from '../types'

const DISPLAY_ID = 0

let notes: Note[] = []
let listCursorIndex = 0
let currentNote: Note | null = null
let currentContentIndex = 0
let lastShownLines = 1

// ── Notes list (with cursor navigation) ──────────────────────────────────────

function renderNotesList(bridge: any): void {
  if (notes.length === 0) {
    setPageContent(bridge, 'No notes yet.\nDouble-click to go back.')
    return
  }

  const lines = notes.map((n, i) => {
    const cursor = i === listCursorIndex ? '> ' : '  '
    const title = n.title || '(untitled)'
    return `${cursor}${title}`
  })
  updateText(bridge, DISPLAY_ID, lines.join('\n'))
}

export async function showNotesList(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('notes_list')
  notes = []
  listCursorIndex = 0

  setPageContent(bridge, 'Loading...')

  try {
    notes = await api.listNotes()
    renderNotesList(bridge)
  } catch {
    updateText(bridge, DISPLAY_ID, 'Failed to load notes.\nDouble-click to go back.')
  }
}

export function handleNotesListEvent(
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
      renderNotesList(bridge)
    }
    return
  }
  if (eventType === 2) { // DOWN — move cursor down
    if (listCursorIndex < notes.length - 1) {
      listCursorIndex++
      renderNotesList(bridge)
    }
    return
  }
  if (eventType === 0) { // CLICK — open selected note
    if (notes.length > 0 && listCursorIndex < notes.length) {
      showNoteDetail(bridge, api, listCursorIndex)
    }
  }
}

// ── Note detail (scroll through content) ────────────────────────────────────

function noteToFakeParagraphs(note: Note): Array<{ original: string; translation: string }> {
  // Break content into ~paragraph-sized chunks for pagination
  const lines = note.content.split('\n')
  const chunks: Array<{ original: string; translation: string }> = []
  let current: string[] = []

  for (const line of lines) {
    current.push(line)
    if (current.length >= 3 || (current.length > 0 && line === '')) {
      const text = current.join('\n').trim()
      if (text) chunks.push({ original: text, translation: '' })
      current = []
    }
  }
  if (current.length > 0) {
    const text = current.join('\n').trim()
    if (text) chunks.push({ original: text, translation: '' })
  }

  if (chunks.length === 0) {
    chunks.push({ original: '(empty)', translation: '' })
  }
  return chunks
}

let noteChunks: Array<{ original: string; translation: string }> = []

function renderNoteDetail(bridge: any): void {
  if (!currentNote) return
  const { text, shown } = formatHistoryDetail(noteChunks, currentContentIndex)
  lastShownLines = Math.max(shown, 1)
  const endIdx = Math.min(currentContentIndex + lastShownLines, noteChunks.length)
  const indicator = `${currentNote.title || '(untitled)'} ${currentContentIndex + 1}-${endIdx}/${noteChunks.length}`
  updateText(bridge, DISPLAY_ID, `${indicator}\n${text}`)
}

export async function showNoteDetail(bridge: any, api: ApiClient, noteIndex: number): Promise<void> {
  appState.navigateTo('notes_detail')
  currentNote = null
  currentContentIndex = 0
  noteChunks = []

  const note = notes[noteIndex]
  if (!note) {
    updateText(bridge, DISPLAY_ID, 'Note not found.\nDouble-click to go back.')
    return
  }

  updateText(bridge, DISPLAY_ID, 'Loading...')

  try {
    const fullNote = await api.getNote(note.id)
    currentNote = fullNote
    noteChunks = noteToFakeParagraphs(fullNote)
    renderNoteDetail(bridge)
  } catch {
    updateText(bridge, DISPLAY_ID, 'Failed to load note.\nDouble-click to go back.')
  }
}

export function handleNoteDetailEvent(
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
      if (currentContentIndex > 0) {
        currentContentIndex = Math.max(0, currentContentIndex - lastShownLines)
        renderNoteDetail(bridge)
      }
      break
    case 2: // DOWN — next page
      if (currentContentIndex + lastShownLines < noteChunks.length) {
        currentContentIndex += lastShownLines
        renderNoteDetail(bridge)
      }
      break
  }
}
