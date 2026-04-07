import { ApiClient } from '../services/api'
import { initKeys } from './keys'
import { initHistory } from './history'
import { initSettings } from './settings'

const WORKER_URL = 'https://notewriter-worker.YOUR_SUBDOMAIN.workers.dev'

export const api = new ApiClient(WORKER_URL)

// ── Auth token ──────────────────────────────────────────────────────────────
const stored = localStorage.getItem('notewriter_auth_token')
if (stored) {
  api.setToken(stored)
}

// ── Toast helper (exported so tabs can use it) ──────────────────────────────
const toastEl = document.getElementById('toast') as HTMLDivElement
let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(message: string, isError = false): void {
  toastEl.textContent = message
  toastEl.classList.toggle('error', isError)
  toastEl.classList.add('show')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800)
}

// ── Tab switching ───────────────────────────────────────────────────────────
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn')
const panels = document.querySelectorAll<HTMLElement>('.panel')

function activateTab(tabName: string): void {
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset['tab'] === tabName))
  panels.forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tabName}`))
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset['tab']
    if (tab) activateTab(tab)
  })
})

// ── Initialize all tabs ─────────────────────────────────────────────────────
initKeys(api, showToast)
initHistory(api, showToast)
initSettings(api, showToast)
