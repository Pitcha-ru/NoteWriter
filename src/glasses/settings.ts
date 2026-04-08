// src/glasses/settings.ts
import { setPageContent, formatMenuText } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Language } from '../types'

const LISTEN_LANGUAGES: Language[] = ['auto', 'en', 'el', 'fr', 'de', 'ru']
const TRANSLATE_LANGUAGES: Language[] = ['en', 'el', 'fr', 'de', 'ru']
const LANGUAGE_LABELS: Record<Language, string> = { auto: 'Auto', en: 'English', el: 'Greek', fr: 'French', de: 'German', ru: 'Russian' }

let selectedIndex = 0

export function showSettings(bridge: any): void {
  appState.navigateTo('settings')
  selectedIndex = 0
  renderSettings(bridge)
}

function renderSettings(bridge: any): void {
  const items = [
    `Listen: ${LANGUAGE_LABELS[appState.settings.listenLang]}`,
    `Translate: ${LANGUAGE_LABELS[appState.settings.translateLang]}`,
  ]
  setPageContent(bridge, formatMenuText(items, selectedIndex))
}

export function handleSettingsEvent(
  bridge: any,
  eventType: number,
  _selectedIndex: number,
  api: ApiClient,
  onBack: () => void
): void {
  if (eventType === 3) { // DOUBLE_CLICK_EVENT — save and go back
    api.saveSettings(appState.settings).catch(() => {})
    // Notify phone UI
    window.dispatchEvent(new CustomEvent('notewriter:glasses-settings-changed', { detail: appState.settings }))
    onBack()
    return
  }
  if (eventType === 1) { // SCROLL_TOP — move cursor up
    selectedIndex = Math.max(0, selectedIndex - 1)
    renderSettings(bridge)
    return
  }
  if (eventType === 2) { // SCROLL_BOTTOM — move cursor down
    selectedIndex = Math.min(1, selectedIndex + 1)
    renderSettings(bridge)
    return
  }
  if (eventType === 0) { // CLICK — cycle language for selected row
    if (selectedIndex === 0) {
      const next = nextLanguage(appState.settings.listenLang, appState.settings.translateLang, LISTEN_LANGUAGES)
      appState.updateSettings({ listenLang: next })
    } else if (selectedIndex === 1) {
      const next = nextLanguage(appState.settings.translateLang, appState.settings.listenLang, TRANSLATE_LANGUAGES)
      appState.updateSettings({ translateLang: next })
    }
    renderSettings(bridge)
  }
}

function nextLanguage(current: Language, exclude: Language, list: Language[]): Language {
  const currentIdx = list.indexOf(current)
  const startIdx = currentIdx >= 0 ? currentIdx : 0
  for (let i = 1; i < list.length; i++) {
    const candidate = list[(startIdx + i) % list.length]
    if (candidate !== exclude) return candidate
  }
  return current
}
