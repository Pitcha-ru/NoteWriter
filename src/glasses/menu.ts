// src/glasses/menu.ts
import { setMenuContent, formatMenuText } from './renderer'
import { appState } from '../services/state'

const MENU_ITEMS = ['Listen', 'Stealth', 'Dialogue', 'Notes', 'History', 'Settings']

let selectedIndex = 0
let menuShownAt = 0

export function showMenu(bridge: any): void {
  appState.navigateTo('menu')
  selectedIndex = 0
  menuShownAt = Date.now()
  renderMenu(bridge)
}

function renderMenu(bridge: any): void {
  const items = MENU_ITEMS.map((text) => {
    if ((text === 'Listen' || text === 'Stealth') && !appState.keysConfigured) {
      return `${text} (setup keys first)`
    }
    if (text === 'Dialogue' && (!appState.keysConfigured || !appState.openaiKeyConfigured)) {
      return `${text} (setup keys first)`
    }
    return text
  })
  setMenuContent(bridge, formatMenuText(items, selectedIndex))
}

export function handleMenuEvent(
  bridge: any,
  eventType: number,
  _selectedIndex: number,
  callbacks: {
    onListen: () => void
    onStealth: () => void
    onDialogue: () => void
    onNotes: () => void
    onHistory: () => void
    onSettings: () => void
    onExit: () => void
  }
): void {
  if (eventType === 3) { callbacks.onExit(); return }
  if (eventType === 1) { selectedIndex = Math.max(0, selectedIndex - 1); renderMenu(bridge); return }
  if (eventType === 2) { selectedIndex = Math.min(MENU_ITEMS.length - 1, selectedIndex + 1); renderMenu(bridge); return }
  if (eventType === 0) {
    if (Date.now() - menuShownAt < 2000) return
    switch (selectedIndex) {
      case 0: if (appState.keysConfigured) callbacks.onListen(); break
      case 1: if (appState.keysConfigured) callbacks.onStealth(); break
      case 2: if (appState.keysConfigured && appState.openaiKeyConfigured) callbacks.onDialogue(); break
      case 3: callbacks.onNotes(); break
      case 4: callbacks.onHistory(); break
      case 5: callbacks.onSettings(); break
    }
  }
}
