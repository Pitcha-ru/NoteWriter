import type { ApiClient } from '../services/api'
import type { Language } from '../types'

type ShowToast = (message: string, isError?: boolean) => void

export function initSettings(api: ApiClient, showToast: ShowToast): void {
  const listenSelect    = document.getElementById('settings-listen-lang')    as HTMLSelectElement
  const translateSelect = document.getElementById('settings-translate-lang') as HTMLSelectElement
  const saveBtn         = document.getElementById('settings-save-btn')       as HTMLButtonElement
  const warnEl          = document.getElementById('settings-same-lang-warn') as HTMLParagraphElement

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
    } catch {
      // silently ignore — dropdowns keep their default (en)
    }
  }

  void loadSettings()

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
      await api.saveSettings({ listenLang, translateLang })
      showToast('Settings saved.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings.', true)
    } finally {
      saveBtn.disabled = false
    }
  })
}
