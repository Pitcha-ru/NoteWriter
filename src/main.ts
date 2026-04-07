import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { appState } from './services/state'
import { ApiClient } from './services/api'
import { showMenu, handleMenuEvent } from './glasses/menu'
import { startListening, handleListenEvent, handleAudioData } from './glasses/listen'
import { showHistoryList, handleHistoryListEvent, handleHistoryDetailEvent } from './glasses/history'
import { showSettings, handleSettingsEvent } from './glasses/settings'

const WORKER_URL = 'https://notewriter-worker.YOUR_SUBDOMAIN.workers.dev'
const api = new ApiClient(WORKER_URL)

async function init() {
  const bridge = await waitForEvenAppBridge()

  // Get or create device ID
  const storedId = await bridge.getLocalStorage('device_id')
  const deviceId = storedId || crypto.randomUUID()
  if (!storedId) await bridge.setLocalStorage('device_id', deviceId)
  appState.setDeviceId(deviceId)

  // Restore or create auth token
  const storedToken = await bridge.getLocalStorage('auth_token')
  if (storedToken) {
    appState.setAuthToken(storedToken)
    api.setToken(storedToken)
  } else {
    try {
      const { token } = await api.register(deviceId)
      appState.setAuthToken(token)
      api.setToken(token)
      await bridge.setLocalStorage('auth_token', token)
    } catch (err) {
      console.error('Registration failed:', err)
    }
  }

  // Load settings + check keys
  try { const s = await api.getSettings(); appState.updateSettings(s) } catch {}
  try {
    const k = await api.getKeys()
    appState.setKeysConfigured(k.elevenlabs_key !== null && k.aws_access_key_id !== null)
  } catch {}

  showMenu(bridge)

  // Event handler
  bridge.onEvenHubEvent((event: any) => {
    if (event.audioEvent?.audioPcm) { handleAudioData(event.audioEvent.audioPcm); return }

    const eventType = event.textEvent?.eventType ?? event.listEvent?.eventType
    const selectedIndex = event.listEvent?.selectedIndex ?? 0
    if (eventType === undefined) return

    // FOREGROUND_ENTER
    if (eventType === 4) {
      api.getSettings().then(s => appState.updateSettings(s)).catch(() => {})
      api.getKeys().then(k => appState.setKeysConfigured(k.elevenlabs_key !== null && k.aws_access_key_id !== null)).catch(() => {})
      return
    }

    switch (appState.currentScreen) {
      case 'menu': handleMenuEvent(bridge, eventType, selectedIndex, {
        onListen: () => startListening(bridge, api),
        onHistory: () => showHistoryList(bridge, api),
        onSettings: () => showSettings(bridge),
      }); break
      case 'listen': handleListenEvent(bridge, eventType, api, () => showMenu(bridge)); break
      case 'history_list': handleHistoryListEvent(bridge, eventType, selectedIndex, api, () => showMenu(bridge)); break
      case 'history_detail': handleHistoryDetailEvent(bridge, eventType, api, () => showHistoryList(bridge, api)); break
      case 'settings': handleSettingsEvent(bridge, eventType, selectedIndex, api, () => showMenu(bridge)); break
    }
  })
}

init()
