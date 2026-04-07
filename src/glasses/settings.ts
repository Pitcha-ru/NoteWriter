// src/glasses/settings.ts
import { createListPage } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Language } from '../types'

const LANGUAGES: Language[] = ['en', 'el', 'fr', 'de']
const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', el: 'Greek', fr: 'French', de: 'German' }

export function showSettings(bridge: any): void {
  appState.navigateTo('settings')
  renderSettings(bridge)
}

function renderSettings(bridge: any): void {
  const items = [
    { text: `Listen: ${LANGUAGE_LABELS[appState.settings.listenLang]}` },
    { text: `Translate: ${LANGUAGE_LABELS[appState.settings.translateLang]}` },
  ]
  createListPage(bridge, items)
}

export function handleSettingsEvent(bridge: any, eventType: number, selectedIndex: number, api: ApiClient, onBack: () => void): void {
  if (eventType === 3) { // DOUBLE_CLICK_EVENT
    api.saveSettings(appState.settings).catch(() => {})
    onBack()
    return
  }
  if (eventType === 0) { // CLICK_EVENT
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
