import { describe, it, expect, beforeEach } from 'vitest'
import { AppState } from '../../services/state'

describe('AppState', () => {
  let state: AppState
  beforeEach(() => { state = new AppState() })

  it('starts with default settings', () => {
    expect(state.settings).toEqual({ listenLang: 'en', translateLang: 'el', context: '', persona: '', translateProvider: 'amazon', translateModel: 'gpt-4o-mini' })
  })
  it('updates settings', () => {
    state.updateSettings({ listenLang: 'fr' })
    expect(state.settings.listenLang).toBe('fr')
  })
  it('tracks current screen', () => {
    expect(state.currentScreen).toBe('menu')
    state.navigateTo('listen')
    expect(state.currentScreen).toBe('listen')
  })
  it('tracks keys configured status', () => {
    expect(state.keysConfigured).toBe(false)
    state.setKeysConfigured(true)
    expect(state.keysConfigured).toBe(true)
  })
  it('stores auth token', () => {
    expect(state.authToken).toBeNull()
    state.setAuthToken('abc123')
    expect(state.authToken).toBe('abc123')
  })
})
