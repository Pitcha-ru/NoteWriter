// src/glasses/notes.ts
import { setPageContent, updateText } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Note } from '../types'

const DISPLAY_ID = 0

let notes: Note[] = []
let listCursorIndex = 0
let currentNote: Note | null = null
let currentContentIndex = 0

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

// Max chars per page (~8 lines * ~38 chars, minus 1 line for title)
const PAGE_CHARS = 260

function noteToPages(note: Note): string[] {
  const fullText = note.content.trim()
  if (!fullText) return ['(empty)']

  // Split into words, build pages that fit on screen
  const words = fullText.split(/\s+/)
  const pages: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > PAGE_CHARS && current) {
      pages.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) pages.push(current)

  return pages.length > 0 ? pages : ['(empty)']
}

let notePages: string[] = []

function renderNoteDetail(bridge: any): void {
  if (!currentNote) return
  const title = currentNote.title || '(untitled)'
  const page = notePages[currentContentIndex] || ''
  const indicator = notePages.length > 1 ? ` ${currentContentIndex + 1}/${notePages.length}` : ''
  updateText(bridge, DISPLAY_ID, `${title}${indicator}\n${page}`)
}

export async function showNoteDetail(bridge: any, api: ApiClient, noteIndex: number): Promise<void> {
  appState.navigateTo('notes_detail')
  currentNote = null
  currentContentIndex = 0
  notePages = []

  const note = notes[noteIndex]
  if (!note) {
    updateText(bridge, DISPLAY_ID, 'Note not found.\nDouble-click to go back.')
    return
  }

  updateText(bridge, DISPLAY_ID, 'Loading...')

  try {
    const fullNote = await api.getNote(note.id)
    currentNote = fullNote
    notePages = noteToPages(fullNote)
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
        currentContentIndex--
        renderNoteDetail(bridge)
      }
      break
    case 2: // DOWN — next page
      if (currentContentIndex < notePages.length - 1) {
        currentContentIndex++
        renderNoteDetail(bridge)
      }
      break
  }
}
