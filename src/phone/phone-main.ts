import { ApiClient } from '../services/api'
import { initKeys } from './keys'
import { initHistory } from './history'
import { initSettings } from './settings'
import { initNotes } from './notes'

const WORKER_URL = 'https://notewriter-worker.kiwibudka.workers.dev'

export const api = new ApiClient(WORKER_URL)

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

// ── Wait for auth token from glasses bridge, then init tabs ─────────────────
function trySetToken(): boolean {
  const token = localStorage.getItem('notewriter_auth_token')
  if (token) {
    api.setToken(token)
    return true
  }
  return false
}

function initTabs(): void {
  initKeys(api, showToast)
  initHistory(api, showToast)
  initSettings(api, showToast)
  initNotes(api, showToast)
  initStartStop()
}

// ── Start/Stop button — controls glasses display ───────────────────────────
function initStartStop(): void {
  const btn = document.getElementById('glasses-start-btn') as HTMLButtonElement
  let running = false

  const hint = document.getElementById('start-hint') as HTMLElement

  function setDisabled(disabled: boolean): void {
    btn.disabled = disabled
    btn.style.opacity = disabled ? '0.4' : '1'
    hint.style.display = disabled ? 'block' : 'none'
  }

  function setRunning(on: boolean): void {
    running = on
    if (on) {
      btn.textContent = 'Stop'
      btn.style.background = '#d44'
    } else {
      btn.textContent = 'Start'
      btn.style.background = '#34c759'
    }
  }

  // Check if keys are configured
  async function checkKeys(): Promise<void> {
    try {
      const keys = await api.getKeys()
      const hasKeys = keys.elevenlabsKey !== null && keys.awsAccessKeyId !== null
      setDisabled(!hasKeys)
    } catch {
      setDisabled(true)
    }
  }

  void checkKeys()
  window.addEventListener('notewriter:keys-changed', () => void checkKeys())

  btn.addEventListener('click', () => {
    if (btn.disabled) return
    if (!running) {
      setRunning(true)
      window.dispatchEvent(new CustomEvent('notewriter:glasses-start'))
    } else {
      setRunning(false)
      window.dispatchEvent(new CustomEvent('notewriter:glasses-stop'))
    }
  })

  // Sync if glasses stop themselves
  window.addEventListener('notewriter:glasses-stopped', () => setRunning(false))
}

if (trySetToken()) {
  // Token already in localStorage (page reload or second load)
  initTabs()
} else {
  // Wait for main.ts to register and store token
  // main.ts dispatches this after saving token to localStorage
  window.addEventListener('notewriter:auth-ready', () => {
    trySetToken()
    initTabs()
  }, { once: true })

  // Fallback: poll for token (in case event was missed)
  const poll = setInterval(() => {
    if (trySetToken()) {
      clearInterval(poll)
      initTabs()
    }
  }, 500)

  // Stop polling after 10 seconds
  setTimeout(() => clearInterval(poll), 10000)
}
