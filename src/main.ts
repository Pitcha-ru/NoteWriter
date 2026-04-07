import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { appState } from './services/state'
import { ApiClient } from './services/api'
import { showMenu, handleMenuEvent } from './glasses/menu'
import { startListening, handleListenEvent, handleAudioData } from './glasses/listen'
import { showHistoryList, handleHistoryListEvent, handleHistoryDetailEvent } from './glasses/history'
import { showSettings, handleSettingsEvent } from './glasses/settings'

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
  } catch {}

  showMenu(bridge)

  // Listen for phone UI changes (both scripts run on same page)
  window.addEventListener('notewriter:keys-changed', async () => {
    try {
      const k = await api.getKeys()
      appState.setKeysConfigured(k.elevenlabsKey !== null && k.awsAccessKeyId !== null)
      // Refresh menu if we're on it (to update Listen availability)
      if (appState.currentScreen === 'menu') showMenu(bridge)
    } catch {}
  })

  window.addEventListener('notewriter:settings-changed', (e: any) => {
    const { listenLang, translateLang } = e.detail
    appState.updateSettings({ listenLang, translateLang })
    // Refresh settings screen if we're on it
    if (appState.currentScreen === 'settings') showSettings(bridge)
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

    if (event.audioEvent?.audioPcm) { handleAudioData(event.audioEvent.audioPcm); return }

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
      api.getKeys().then(k => appState.setKeysConfigured(k.elevenlabsKey !== null && k.awsAccessKeyId !== null)).catch(() => {})
      return
    }

    switch (appState.currentScreen) {
      case 'menu': handleMenuEvent(bridge, eventType, selectedIndex, {
        onListen: () => navigateWithGuard(() => startListening(bridge, api)),
        onHistory: () => navigateWithGuard(() => showHistoryList(bridge, api)),
        onSettings: () => navigateWithGuard(() => showSettings(bridge)),
      }); break
      case 'listen': handleListenEvent(bridge, eventType, api, () => navigateWithGuard(() => showMenu(bridge))); break
      case 'history_list': handleHistoryListEvent(bridge, eventType, selectedIndex, api, () => navigateWithGuard(() => showMenu(bridge))); break
      case 'history_detail': handleHistoryDetailEvent(bridge, eventType, api, () => navigateWithGuard(() => showHistoryList(bridge, api))); break
      case 'settings': handleSettingsEvent(bridge, eventType, selectedIndex, api, () => navigateWithGuard(() => showMenu(bridge))); break
    }
  })
}

init()
