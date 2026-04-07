// src/glasses/settings.ts
import { createTextPage, formatMenuText, resetPageState } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Language } from '../types'

const LANGUAGES: Language[] = ['en', 'el', 'fr', 'de']
const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', el: 'Greek', fr: 'French', de: 'German' }

let selectedIndex = 0

export function showSettings(bridge: any): void {
  appState.navigateTo('settings')
  resetPageState()
  selectedIndex = 0
  renderSettings(bridge)
}

function renderSettings(bridge: any): void {
  const items = [
    `Listen: ${LANGUAGE_LABELS[appState.settings.listenLang]}`,
    `Translate: ${LANGUAGE_LABELS[appState.settings.translateLang]}`,
  ]
  createTextPage(bridge, formatMenuText(items, selectedIndex))
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
      const next = nextLanguage(appState.settings.listenLang, appState.settings.translateLang)
      appState.updateSettings({ listenLang: next })
    } else if (selectedIndex === 1) {
      const next = nextLanguage(appState.settings.translateLang, appState.settings.listenLang)
      appState.updateSettings({ translateLang: next })
    }
    renderSettings(bridge)
  }
}

function nextLanguage(current: Language, exclude: Language): Language {
  const currentIdx = LANGUAGES.indexOf(current)
  for (let i = 1; i < LANGUAGES.length; i++) {
    const candidate = LANGUAGES[(currentIdx + i) % LANGUAGES.length]
    if (candidate !== exclude) return candidate
  }
  return current
}
