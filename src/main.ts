import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { appState } from './services/state'
import { ApiClient } from './services/api'
import { showMenu, handleMenuEvent } from './glasses/menu'
import { startListening, handleListenEvent, handleAudioData, resetListen } from './glasses/listen'
import { startDialogue, handleDialogueEvent, handleDialogueAudio, resetDialogue } from './glasses/dialogue'
import { showHistoryList, handleHistoryListEvent, handleHistoryDetailEvent } from './glasses/history'
import { showNotesList, handleNotesListEvent, handleNoteDetailEvent } from './glasses/notes'
import { showSettings, handleSettingsEvent } from './glasses/settings'
import { resetPage } from './glasses/renderer'

const WORKER_URL = 'https://notewriter-worker.kiwibudka.workers.dev'
const api = new ApiClient(WORKER_URL)

async function init() {
  const bridge = await waitForEvenAppBridge()

  // Get or create device ID
  const storedId = await bridge.getLocalStorage('device_id')
  const deviceId = storedId || crypto.randomUUID()
  if (!storedId) await bridge.setLocalStorage('device_id', deviceId)
  appState.setDeviceId(deviceId)

  // Restore or create auth token
  // Try bridge storage first, fall back to localStorage (for phone UI sharing)
  const storedToken = await bridge.getLocalStorage('auth_token') || localStorage.getItem('notewriter_auth_token')
  if (storedToken) {
    appState.setAuthToken(storedToken)
    api.setToken(storedToken)
    localStorage.setItem('notewriter_auth_token', storedToken)
    await bridge.setLocalStorage('auth_token', storedToken)
  } else {
    try {
      const { token } = await api.register(deviceId)
      appState.setAuthToken(token)
      api.setToken(token)
      localStorage.setItem('notewriter_auth_token', token)
      await bridge.setLocalStorage('auth_token', token)
    } catch (err) {
      console.error('Registration failed:', err)
    }
  }
  // Notify phone UI that auth token is ready
  window.dispatchEvent(new CustomEvent('notewriter:auth-ready'))

  // Load settings + check keys
  try { const s = await api.getSettings(); appState.updateSettings(s) } catch {}
  try {
    const k = await api.getKeys()
    appState.setKeysConfigured(k.elevenlabsKey !== null && k.awsAccessKeyId !== null)
    appState.openaiKeyConfigured = k.openaiKey !== null
  } catch {}

  showMenu(bridge)

  // Listen for phone UI changes (both scripts run on same page)
  window.addEventListener('notewriter:keys-changed', async () => {
    try {
      const k = await api.getKeys()
      appState.setKeysConfigured(k.elevenlabsKey !== null && k.awsAccessKeyId !== null)
      appState.openaiKeyConfigured = k.openaiKey !== null
      // Refresh menu if we're on it (to update Listen/Dialogue availability)
      if (appState.currentScreen === 'menu') showMenu(bridge)
    } catch {}
  })

  window.addEventListener('notewriter:settings-changed', (e: any) => {
    const { listenLang, translateLang, context, persona } = e.detail
    appState.updateSettings({ listenLang, translateLang, context: context ?? appState.settings.context, persona: persona ?? appState.settings.persona })
    if (appState.currentScreen === 'settings') showSettings(bridge)
  })

  // Sync: if phone deletes a session while glasses are in history, refresh
  window.addEventListener('notewriter:session-deleted', () => {
    if (appState.currentScreen === 'history_list') {
      showHistoryList(bridge, api)
    }
  })

  // Sync: if phone changes notes while glasses are in notes_list, refresh
  window.addEventListener('notewriter:notes-changed', () => {
    if (appState.currentScreen === 'notes_list') {
      showNotesList(bridge, api)
    }
  })

  // Clean reset of all module state
  function resetAll(): void {
    resetListen()
    resetDialogue()
    appState.navigateTo('menu')
  }

  // Phone Start/Stop button
  window.addEventListener('notewriter:glasses-start', () => {
    resetAll()
    resetPage()
    showMenu(bridge)
  })

  window.addEventListener('notewriter:glasses-stop', () => {
    resetAll()
    try { bridge.shutDownPageContainer(0) } catch {}
    resetPage()
  })

  // Block click events briefly after screen transitions
  // (simulator sends a ghost click after double-click)
  let lastScreenChange = 0

  function navigateWithGuard(fn: () => void): void {
    lastScreenChange = Date.now()
    fn()
  }

  // Event handler
  bridge.onEvenHubEvent((event: any) => {

    if (event.audioEvent?.audioPcm) { handleAudioData(event.audioEvent.audioPcm); handleDialogueAudio(event.audioEvent.audioPcm); return }

    // Parse eventType
    let eventType: number | undefined =
      event.textEvent?.eventType ??
      event.listEvent?.eventType ??
      event.sysEvent?.eventType

    // Click from simulator: sysEvent has eventSource but no eventType
    if (eventType === undefined && event.sysEvent?.eventSource !== undefined) {
      eventType = 0 // CLICK_EVENT
    }

    const selectedIndex = event.listEvent?.selectedIndex ?? 0
    if (eventType === undefined) return

    // Block CLICK events for 1.5s after screen change (ghost click from double-click)
    if (eventType === 0 && Date.now() - lastScreenChange < 1500) return

    // FOREGROUND_ENTER
    if (eventType === 4) {
      api.getSettings().then(s => appState.updateSettings(s)).catch(() => {})
      api.getKeys().then(k => {
        appState.setKeysConfigured(k.elevenlabsKey !== null && k.awsAccessKeyId !== null)
        appState.openaiKeyConfigured = k.openaiKey !== null
      }).catch(() => {})
      return
    }

    switch (appState.currentScreen) {
      case 'menu': handleMenuEvent(bridge, eventType, selectedIndex, {
        onListen: () => navigateWithGuard(() => startListening(bridge, api)),
        onDialogue: () => navigateWithGuard(() => startDialogue(bridge, api)),
        onNotes: () => navigateWithGuard(() => showNotesList(bridge, api)),
        onHistory: () => navigateWithGuard(() => showHistoryList(bridge, api)),
        onSettings: () => navigateWithGuard(() => showSettings(bridge)),
        onExit: () => {
          resetAll()
          try { bridge.shutDownPageContainer(0) } catch {}
          resetPage()
          window.dispatchEvent(new CustomEvent('notewriter:glasses-stopped'))
        },
      }); break
      case 'listen': handleListenEvent(bridge, eventType, api, () => navigateWithGuard(() => { resetAll(); showMenu(bridge) })); break
      case 'dialogue': handleDialogueEvent(bridge, eventType, api, () => navigateWithGuard(() => { resetAll(); showMenu(bridge) })); break
      case 'notes_list': handleNotesListEvent(bridge, eventType, selectedIndex, api, () => navigateWithGuard(() => showMenu(bridge))); break
      case 'notes_detail': handleNoteDetailEvent(bridge, eventType, api, () => navigateWithGuard(() => showNotesList(bridge, api))); break
      case 'history_list': handleHistoryListEvent(bridge, eventType, selectedIndex, api, () => navigateWithGuard(() => showMenu(bridge))); break
      case 'history_detail': handleHistoryDetailEvent(bridge, eventType, api, () => navigateWithGuard(() => showHistoryList(bridge, api))); break
      case 'settings': handleSettingsEvent(bridge, eventType, selectedIndex, api, () => navigateWithGuard(() => showMenu(bridge))); break
    }
  })
}

init()
