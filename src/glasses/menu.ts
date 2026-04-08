// src/glasses/menu.ts
import { setPageContent, formatMenuText } from './renderer'
import { appState } from '../services/state'

const MENU_ITEMS = ['Listen', 'Auto', 'Dialogue', 'History', 'Settings']

let selectedIndex = 0

export function showMenu(bridge: any): void {
  appState.navigateTo('menu')
  selectedIndex = 0
  renderMenu(bridge)
}

function renderMenu(bridge: any): void {
  const items = MENU_ITEMS.map((text) => {
    if ((text === 'Listen' || text === 'Auto') && !appState.keysConfigured) {
      return `${text} (setup keys)`
    }
    if (text === 'Dialogue' && (!appState.keysConfigured || !appState.openaiKeyConfigured)) {
      return `${text} (setup keys)`
    }
    return text
  })
  setPageContent(bridge, formatMenuText(items, selectedIndex))
}

export function handleMenuEvent(
  bridge: any,
  eventType: number,
  _selectedIndex: number,
  callbacks: { onListen: () => void; onAuto: () => void; onDialogue: () => void; onHistory: () => void; onSettings: () => void }
): void {
  if (eventType === 1) {
    selectedIndex = Math.max(0, selectedIndex - 1)
    renderMenu(bridge)
    return
  }
  if (eventType === 2) {
    selectedIndex = Math.min(MENU_ITEMS.length - 1, selectedIndex + 1)
    renderMenu(bridge)
    return
  }
  if (eventType === 0) {
    switch (selectedIndex) {
      case 0:
        if (appState.keysConfigured) callbacks.onListen()
        break
      case 1:
        if (appState.keysConfigured) callbacks.onAuto()
        break
      case 2:
        if (appState.keysConfigured && appState.openaiKeyConfigured) callbacks.onDialogue()
        break
      case 3:
        callbacks.onHistory()
        break
      case 4:
        callbacks.onSettings()
        break
    }
  }
}
