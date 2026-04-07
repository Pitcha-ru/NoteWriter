// src/glasses/menu.ts
import { createTextPage, formatMenuText, resetPageState } from './renderer'
import { appState } from '../services/state'

const MENU_ITEMS = ['Listen', 'History', 'Settings']

let selectedIndex = 0

export function showMenu(bridge: any): void {
  appState.navigateTo('menu')
  resetPageState()
  selectedIndex = 0
  renderMenu(bridge)
}

function renderMenu(bridge: any): void {
  const items = MENU_ITEMS.map((text) => {
    if (text === 'Listen' && !appState.keysConfigured) {
      return `${text} (setup keys first)`
    }
    return text
  })
  createTextPage(bridge, formatMenuText(items, selectedIndex))
}

export function handleMenuEvent(
  bridge: any,
  eventType: number,
  _selectedIndex: number,
  callbacks: { onListen: () => void; onHistory: () => void; onSettings: () => void }
): void {
  // SCROLL_TOP (1) = move cursor up, SCROLL_BOTTOM (2) = move cursor down, CLICK (0) = select
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
        callbacks.onHistory()
        break
      case 2:
        callbacks.onSettings()
        break
    }
  }
}
