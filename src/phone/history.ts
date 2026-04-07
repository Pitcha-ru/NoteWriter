import type { ApiClient } from '../services/api'
import type { Session, Paragraph } from '../types'

type ShowToast = (message: string, isError?: boolean) => void

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDate(dateStr: string): string {
  try {
    // D1 returns "2026-04-07 16:20:00" without T/Z — normalize
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

const LANG_NAMES: Record<string, string> = {
  en: 'English', el: 'Greek', fr: 'French', de: 'German', ru: 'Russian',
}

function langName(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase()
}

// ── State ────────────────────────────────────────────────────────────────────
let listCursor: string | null = null
let detailSessionId: string | null = null
let detailCursor: number | undefined = undefined

export function initHistory(api: ApiClient, showToast: ShowToast): void {
  const listView      = document.getElementById('history-list-view')  as HTMLDivElement
  const detailView    = document.getElementById('history-detail')      as HTMLDivElement
  const listContainer = document.getElementById('session-list-container') as HTMLDivElement
  const paraContainer = document.getElementById('paragraph-list-container') as HTMLDivElement
  const detailTitle   = document.getElementById('detail-title')        as HTMLDivElement
  const loadMoreBtn   = document.getElementById('history-load-more')   as HTMLButtonElement
  const detailMoreBtn = document.getElementById('detail-load-more')    as HTMLButtonElement
  const backBtn       = document.getElementById('history-back-btn')    as HTMLButtonElement

  // Load history when tab is activated
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset['tab'] === 'history' && listView.style.display !== 'none') {
        void loadSessionList(true)
      }
    })
  })

  backBtn.addEventListener('click', () => {
    showList()
  })

  loadMoreBtn.addEventListener('click', () => {
    void loadSessionList(false)
  })

  detailMoreBtn.addEventListener('click', () => {
    if (detailSessionId !== null) {
      void loadDetail(detailSessionId, false)
    }
  })

  // ── List helpers ──────────────────────────────────────────────────────────

  function showList(): void {
    listView.style.display = 'block'
    detailView.style.display = 'none'
  }

  function showDetail(): void {
    listView.style.display = 'none'
    detailView.style.display = 'block'
  }

  function renderSessionItem(session: Session): HTMLElement {
    const div = document.createElement('div')
    div.className = 'session-item'

    const preview = session.preview
      ? escapeHtml(session.preview.slice(0, 60)) + (session.preview.length > 60 ? '...' : '')
      : 'Empty session'

    div.innerHTML = `
      <div class="session-info">
        <div class="session-preview">${preview}</div>
        <div class="session-meta">${escapeHtml(formatDate(session.createdAt))}  ·  ${escapeHtml(langName(session.listenLang))} → ${escapeHtml(langName(session.translateLang))}</div>
      </div>
      <span class="session-chevron">›</span>
    `

    div.addEventListener('click', () => {
      void openSession(session)
    })

    return div
  }

  async function loadSessionList(fresh: boolean): Promise<void> {
    if (fresh) {
      listCursor = null
      listContainer.innerHTML = '<p class="empty-msg">Loading…</p>'
      loadMoreBtn.style.display = 'none'
    }

    try {
      const result = await api.listSessions(listCursor ?? undefined)

      if (fresh) listContainer.innerHTML = ''

      if (result.sessions.length === 0 && fresh) {
        listContainer.innerHTML = '<p class="empty-msg">No sessions yet.</p>'
      } else {
        result.sessions.forEach(s => listContainer.appendChild(renderSessionItem(s)))
      }

      listCursor = result.cursor
      loadMoreBtn.style.display = result.cursor ? 'block' : 'none'
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load sessions.', true)
      if (fresh) listContainer.innerHTML = '<p class="empty-msg">Failed to load.</p>'
    }
  }

  // ── Detail helpers ────────────────────────────────────────────────────────

  function renderParagraph(para: Paragraph): HTMLElement {
    const div = document.createElement('div')
    div.className = 'paragraph-block'
    div.innerHTML = `
      <div class="para-original">${escapeHtml(para.original)}</div>
      <div class="para-translation">${escapeHtml(para.translation)}</div>
    `
    return div
  }

  async function openSession(session: Session): Promise<void> {
    detailSessionId = session.id
    detailCursor = undefined
    paraContainer.innerHTML = '<p class="empty-msg">Loading…</p>'
    detailMoreBtn.style.display = 'none'

    detailTitle.textContent =
      `${formatDate(session.createdAt)} · ${langName(session.listenLang)} → ${langName(session.translateLang)}`

    showDetail()
    await loadDetail(session.id, true)
  }

  async function loadDetail(sessionId: string, fresh: boolean): Promise<void> {
    try {
      const result = await api.getSession(sessionId, detailCursor)

      if (fresh) paraContainer.innerHTML = ''

      if (result.paragraphs.length === 0 && fresh) {
        paraContainer.innerHTML = '<p class="empty-msg">No paragraphs yet.</p>'
      } else {
        result.paragraphs.forEach(p => paraContainer.appendChild(renderParagraph(p)))
      }

      // cursor for paragraphs is a number (position-based)
      detailCursor = result.cursor !== null ? Number(result.cursor) : undefined
      detailMoreBtn.style.display = result.cursor !== null ? 'block' : 'none'
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load session.', true)
      if (fresh) paraContainer.innerHTML = '<p class="empty-msg">Failed to load.</p>'
    }
  }

  // Initial load when panel is already visible on page load
  void loadSessionList(true)
}
