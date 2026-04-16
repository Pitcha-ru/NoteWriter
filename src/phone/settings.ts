import { download, clear } from '../services/logger'
import type { ApiClient } from '../services/api'
import type { Language } from '../types'

type ShowToast = (message: string, isError?: boolean) => void

export function initSettings(api: ApiClient, showToast: ShowToast): void {
  const listenSelect    = document.getElementById('settings-listen-lang')    as HTMLSelectElement
  const translateSelect = document.getElementById('settings-translate-lang') as HTMLSelectElement
  const saveBtn         = document.getElementById('settings-save-btn')       as HTMLButtonElement
  const warnEl          = document.getElementById('settings-same-lang-warn') as HTMLParagraphElement
  const contextArea     = document.getElementById('settings-context')        as HTMLTextAreaElement
  const personaArea     = document.getElementById('settings-persona')        as HTMLTextAreaElement

  // Hide warning whenever user changes a dropdown
  function onSelectChange(): void {
    if (listenSelect.value !== translateSelect.value) {
      warnEl.classList.remove('show')
    }
  }

  listenSelect.addEventListener('change', onSelectChange)
  translateSelect.addEventListener('change', onSelectChange)

  // Load current settings on init
  async function loadSettings(): Promise<void> {
    try {
      const settings = await api.getSettings()
      listenSelect.value    = settings.listenLang
      translateSelect.value = settings.translateLang
      contextArea.value = settings.context ?? ''
      personaArea.value = settings.persona ?? ''
    } catch {
      // silently ignore — dropdowns keep their default (en)
    }
  }

  void loadSettings()

  // Listen for glasses settings changes
  window.addEventListener('notewriter:glasses-settings-changed', (e: any) => {
    const { listenLang, translateLang } = e.detail
    listenSelect.value = listenLang
    translateSelect.value = translateLang
    contextArea.value = e.detail.context ?? contextArea.value
    personaArea.value = e.detail.persona ?? personaArea.value
  })

  saveBtn.addEventListener('click', async () => {
    const listenLang    = listenSelect.value    as Language
    const translateLang = translateSelect.value as Language

    if (listenLang === translateLang) {
      warnEl.classList.add('show')
      return
    }

    warnEl.classList.remove('show')
    saveBtn.disabled = true

    try {
      await api.saveSettings({ listenLang, translateLang, context: contextArea.value, persona: personaArea.value })
      showToast('Settings saved.')
      // Notify glasses UI that settings changed
      window.dispatchEvent(new CustomEvent('notewriter:settings-changed', { detail: { listenLang, translateLang, context: contextArea.value, persona: personaArea.value } }))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings.', true)
    } finally {
      saveBtn.disabled = false
    }
  })

  // Log file controls
  const logToggle = document.getElementById('log-toggle') as HTMLAnchorElement
  const logControls = document.getElementById('log-controls') as HTMLDivElement
  const logDownloadBtn = document.getElementById('log-download-btn') as HTMLButtonElement
  const logClearBtn = document.getElementById('log-clear-btn') as HTMLButtonElement

  logToggle.addEventListener('click', (e) => {
    e.preventDefault()
    const visible = logControls.style.display !== 'none'
    logControls.style.display = visible ? 'none' : 'block'
    logToggle.textContent = visible ? 'Log file ›' : 'Log file ‹'
  })

  logDownloadBtn.addEventListener('click', () => {
    if (!download()) {
      showToast('Log is empty')
    }
  })

  logClearBtn.addEventListener('click', () => {
    clear()
    showToast('Log cleared')
  })
}
