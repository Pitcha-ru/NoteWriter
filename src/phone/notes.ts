import type { ApiClient } from '../services/api'
import type { Note } from '../types'

type ShowToast = (message: string, isError?: boolean) => void

function escapeHtml(text: string | undefined | null): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function initNotes(api: ApiClient, showToast: ShowToast): void {
  const listView      = document.getElementById('notes-list-view') as HTMLDivElement
  const editorView    = document.getElementById('notes-editor') as HTMLDivElement
  const listContainer = document.getElementById('notes-list-container') as HTMLDivElement
  const newBtn        = document.getElementById('notes-new-btn') as HTMLButtonElement
  const saveBtn       = document.getElementById('notes-editor-save') as HTMLButtonElement
  const cancelBtn     = document.getElementById('notes-editor-cancel') as HTMLButtonElement
  const titleInput    = document.getElementById('notes-editor-title') as HTMLInputElement
  const contentInput  = document.getElementById('notes-editor-content') as HTMLTextAreaElement

  let editingNoteId: string | null = null

  // ── View switching ──────────────────────────────────────────────────────────

  function showList(): void {
    listView.style.display = 'block'
    editorView.style.display = 'none'
  }

  function showEditor(note?: Note): void {
    editingNoteId = note?.id ?? null
    titleInput.value = note?.title ?? ''
    contentInput.value = note?.content ?? ''
    listView.style.display = 'none'
    editorView.style.display = 'block'
    titleInput.focus()
  }

  // ── Load notes on tab activation ────────────────────────────────────────────

  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset['tab'] === 'notes') {
        showList()
        void loadNotes()
      }
    })
  })

  // Sync: reload when notes change from glasses side
  // (phone-initiated changes already call loadNotes directly)

  // ── Render ──────────────────────────────────────────────────────────────────

  function renderNoteItem(note: Note): HTMLElement {
    const div = document.createElement('div')
    div.className = 'note-item'

    const title = note.title || '(untitled)'
    const preview = note.content
      ? note.content.slice(0, 60) + (note.content.length > 60 ? '...' : '')
      : '(empty)'

    div.innerHTML = `
      <div class="note-info">
        <div class="note-title">${escapeHtml(title)}</div>
        <div class="note-preview">${escapeHtml(preview)}</div>
      </div>
      <div class="note-actions">
        <button class="note-action-btn edit" aria-label="Edit note" title="Edit">&#9998;</button>
        <button class="note-action-btn delete" aria-label="Delete note" title="Delete">&#128465;</button>
      </div>
    `

    const infoEl = div.querySelector<HTMLDivElement>('.note-info')!
    infoEl.addEventListener('click', () => showEditor(note))

    const editBtn = div.querySelector<HTMLButtonElement>('.note-action-btn.edit')!
    editBtn.addEventListener('click', () => showEditor(note))

    const deleteBtn = div.querySelector<HTMLButtonElement>('.note-action-btn.delete')!
    deleteBtn.addEventListener('click', () => {
      api.deleteNote(note.id).then(() => {
        div.remove()
        showToast('Note deleted')
        window.dispatchEvent(new CustomEvent('notewriter:notes-changed'))
      }).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : 'Failed to delete note.', true)
      })
    })

    return div
  }

  async function loadNotes(): Promise<void> {
    listContainer.innerHTML = '<p class="empty-msg">Loading...</p>'
    try {
      const notes = await api.listNotes()
      listContainer.innerHTML = ''
      if (notes.length === 0) {
        listContainer.innerHTML = '<p class="empty-msg">No notes yet. Tap New Note to create one.</p>'
      } else {
        notes.forEach(n => listContainer.appendChild(renderNoteItem(n)))
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load notes.', true)
      listContainer.innerHTML = '<p class="empty-msg">Failed to load.</p>'
    }
  }

  // ── New note button ─────────────────────────────────────────────────────────

  newBtn.addEventListener('click', () => showEditor())

  // ── Save ────────────────────────────────────────────────────────────────────

  saveBtn.addEventListener('click', () => {
    const title = titleInput.value.trim()
    const content = contentInput.value.trim()

    const doSave = editingNoteId
      ? api.updateNote(editingNoteId, title, content)
      : api.createNote(title, content)

    doSave.then(() => {
      showToast(editingNoteId ? 'Note saved' : 'Note created')
      showList()
      void loadNotes()
      // Notify glasses (don't trigger our own reload — loadNotes already called above)
      window.dispatchEvent(new CustomEvent('notewriter:notes-changed'))
    }).catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to save note.', true)
    })
  })

  // ── Cancel ──────────────────────────────────────────────────────────────────

  cancelBtn.addEventListener('click', () => {
    showList()
  })

  // ── Initial load ────────────────────────────────────────────────────────────

  void loadNotes()
}
