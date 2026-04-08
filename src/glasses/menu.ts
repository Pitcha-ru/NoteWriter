// src/glasses/menu.ts
import { setPageContent, formatMenuText } from './renderer'
import { appState } from '../services/state'

const MENU_ITEMS = ['Listen', 'Dialogue', 'History', 'Settings']

let selectedIndex = 0

export function showMenu(bridge: any): void {
  appState.navigateTo('menu')
  selectedIndex = 0
  renderMenu(bridge)
}

function renderMenu(bridge: any): void {
  const items = MENU_ITEMS.map((text) => {
    if (text === 'Listen' && !appState.keysConfigured) {
      return `${text} (setup keys first)`
    }
    if (text === 'Dialogue' && (!appState.keysConfigured || !appState.openaiKeyConfigured)) {
      return `${text} (setup keys first)`
    }
    return text
  })
  setPageContent(bridge, formatMenuText(items, selectedIndex))
}

export function handleMenuEvent(
  bridge: any,
  eventType: number,
  _selectedIndex: number,
  callbacks: { onListen: () => void; onDialogue: () => void; onHistory: () => void; onSettings: () => void; onExit: () => void }
): void {
  // DOUBLE_CLICK (3) = shut down display
  if (eventType === 3) {
    callbacks.onExit()
    return
  }
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
        if (appState.keysConfigured && appState.openaiKeyConfigured) callbacks.onDialogue()
        break
      case 2:
        callbacks.onHistory()
        break
      case 3:
        callbacks.onSettings()
        break
    }
  }
}
