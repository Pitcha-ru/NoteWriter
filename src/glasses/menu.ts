// src/glasses/menu.ts
import { createListPage } from './renderer'
import { appState } from '../services/state'

const MENU_ITEMS = ['Listen', 'History', 'Settings']

export function showMenu(bridge: any): void {
  appState.navigateTo('menu')
  const items = MENU_ITEMS.map(text => {
    if (text === 'Listen' && !appState.keysConfigured) {
      return { text: `${text} (setup keys first)` }
    }
    return { text }
  })
  createListPage(bridge, items)
}

export function handleMenuEvent(
  bridge: any,
  eventType: number,
  selectedIndex: number,
  callbacks: { onListen: () => void; onHistory: () => void; onSettings: () => void }
): void {
  if (eventType !== 0) return // Only CLICK_EVENT
  switch (selectedIndex) {
    case 0: if (appState.keysConfigured) callbacks.onListen(); break
    case 1: callbacks.onHistory(); break
    case 2: callbacks.onSettings(); break
  }
}
