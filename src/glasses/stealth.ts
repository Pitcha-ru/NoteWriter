// src/glasses/stealth.ts
import { setMenuContent } from './renderer'
import { appState } from '../services/state'
import { SttClient } from '../services/stt'
import { ApiClient } from '../services/api'
import { log } from '../services/logger'

type StealthState = 'active' | 'paused'

let stealthState: StealthState = 'active'
let sttClient: SttClient | null = null
let currentBridge: any = null
let currentApi: ApiClient | null = null
let indicatorTimer: ReturnType<typeof setInterval> | null = null
let indicatorFrame = 0
let saveQueue: Promise<any> = Promise.resolve()
let isResuming = false

function enqueueSave(fn: () => Promise<any>): void {
  saveQueue = saveQueue.then(fn, fn)
}

function isNoise(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^\(.*\)$/.test(t)) return true
  if (/^\[.*\]$/.test(t)) return true
  if (/^\{.*\}$/.test(t)) return true
  if (/^[*].*[*]$/.test(t)) return true
  return false
}

function updateDisplay(): void {
  if (!currentBridge) return
  if (stealthState === 'paused') {
    setMenuContent(currentBridge, '‖')
    return
  }
  const dot = indicatorFrame % 2 === 0 ? '●' : ' '
  setMenuContent(currentBridge, dot)
}

function startIndicator(): void {
  if (indicatorTimer) return
  indicatorTimer = setInterval(() => {
    indicatorFrame++
    updateDisplay()
  }, 500)
}

function stopIndicator(): void {
  if (indicatorTimer !== null) { clearInterval(indicatorTimer); indicatorTimer = null }
}

function pauseStealth(): void {
  log('STEALTH', 'Paused')
  stealthState = 'paused'
  stopIndicator()
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch {}
  }
  sttClient?.disconnect()
  sttClient = null
  updateDisplay()
}

async function resumeStealth(): Promise<void> {
  if (isResuming || !currentBridge || !currentApi) return
  isResuming = true

  log('STEALTH', 'Resuming')
  stealthState = 'active'

  setMenuContent(currentBridge, '...')

  try {
    const { token } = await currentApi.getSttToken()
    sttClient = new SttClient(token, { language: appState.settings.listenLang, vadSilenceThresholdSecs: '0.5' })

    sttClient.onCommittedTranscript((text) => {
      if (isNoise(text)) return
      log('STEALTH', `Committed: "${text.slice(0, 60)}"`)
      enqueueSave(async () => {
        const sessionId = appState.currentSessionId
        if (!sessionId) return
        try {
          await currentApi!.appendParagraph(sessionId, text, '')
          window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
        } catch (e) {
          log('ERR', `Stealth paragraph save failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      })
    })

    sttClient.onPartialTranscript(() => {}) // discard — no display
    sttClient.onError((e) => log('ERR', `Stealth STT error: ${e.message}`))
    sttClient.onStatus(() => {})

    sttClient.connect()
    currentBridge.audioControl(true)
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('ERR', `Stealth resume failed: ${msg}`)
    stealthState = 'paused'
    setMenuContent(currentBridge, `! Error\nClick retry`)
  } finally {
    isResuming = false
  }
}

export function resetStealth(): void {
  stopIndicator()
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch {}
  }
  sttClient?.disconnect()
  sttClient = null
  stealthState = 'active'
  isResuming = false
  indicatorFrame = 0
  saveQueue = Promise.resolve()
  appState.currentSessionId = null
  currentBridge = null
  currentApi = null
}

export async function startStealth(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('stealth')
  currentBridge = bridge
  currentApi = api
  stealthState = 'active'
  indicatorFrame = 0
  saveQueue = Promise.resolve()

  setMenuContent(bridge, 'Connecting...')

  try {
    const session = await api.createSession(
      appState.settings.listenLang,
      appState.settings.translateLang,
      'stealth'
    )
    appState.currentSessionId = session.id
    log('STEALTH', `Session created id=${session.id}`)
    window.dispatchEvent(new CustomEvent('notewriter:session-created'))

    const { token } = await api.getSttToken()
    sttClient = new SttClient(token, { language: appState.settings.listenLang, vadSilenceThresholdSecs: '0.5' })

    sttClient.onCommittedTranscript((text) => {
      if (isNoise(text)) return
      log('STEALTH', `Committed: "${text.slice(0, 60)}"`)
      enqueueSave(async () => {
        const sessionId = appState.currentSessionId
        if (!sessionId) return
        try {
          await api.appendParagraph(sessionId, text, '')
          window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
        } catch (e) {
          log('ERR', `Stealth paragraph save failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      })
    })

    sttClient.onPartialTranscript(() => {})
    sttClient.onError((e) => log('ERR', `Stealth STT error: ${e.message}`))
    sttClient.onStatus(() => {})

    sttClient.connect()
    bridge.audioControl(true)
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('ERR', `Stealth start failed: ${msg}`)
    setMenuContent(bridge, `Error: ${msg}\nDouble-click to go back.`)
  }
}

export function handleStealthEvent(
  bridge: any,
  eventType: number,
  api: ApiClient,
  onBack: () => void
): void {
  if (eventType === 3) { // DOUBLE_CLICK — exit from any state
    stopIndicator()
    if (currentBridge) {
      try { currentBridge.audioControl(false) } catch {}
    }
    sttClient?.disconnect()
    sttClient = null
    const sessionId = appState.currentSessionId
    // Await queue then finalize (fire-and-forget after queue drains)
    saveQueue.finally(() => {
      if (sessionId) api.finalizeSession(sessionId).catch(() => {})
    })
    onBack()
    return
  }
  if (stealthState === 'active' && eventType === 0) { // CLICK — pause
    pauseStealth()
    return
  }
  if (stealthState === 'paused' && eventType === 0) { // CLICK — resume
    resumeStealth()
    return
  }
}

export function handleStealthAudio(pcmData: any): void {
  if (stealthState !== 'active') return
  sttClient?.sendAudio(pcmData)
}
