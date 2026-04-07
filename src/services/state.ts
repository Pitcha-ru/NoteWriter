import type { Settings, Language } from '../types'

export type Screen = 'menu' | 'listen' | 'history_list' | 'history_detail' | 'settings'

export class AppState {
  settings: Settings = { listenLang: 'en', translateLang: 'el' }
  currentScreen: Screen = 'menu'
  keysConfigured = false
  authToken: string | null = null
  deviceId: string | null = null
  currentSessionId: string | null = null

  updateSettings(settings: Partial<Settings>): void {
    this.settings = { ...this.settings, ...settings }
  }
  navigateTo(screen: Screen): void { this.currentScreen = screen }
  setKeysConfigured(configured: boolean): void { this.keysConfigured = configured }
  setAuthToken(token: string): void { this.authToken = token }
  setDeviceId(id: string): void { this.deviceId = id }
}

export const appState = new AppState()
