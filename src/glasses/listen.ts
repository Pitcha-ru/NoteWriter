// src/glasses/listen.ts
import { setPageContent, updateText, formatListenDisplay } from './renderer'
import { appState } from '../services/state'
import { SttClient } from '../services/stt'
import { ApiClient } from '../services/api'

const DISPLAY_ID = 0
let sttClient: SttClient | null = null
let committedPairs: Array<{ original: string; translation: string }> = []
let partialText = ''

let currentBridge: any = null
let currentApi: ApiClient | null = null

// State: 'active' = listening, 'paused' = paused (click to resume, double-click to exit)
let listenState: 'active' | 'paused' = 'active'

// Indicator
let indicatorTimer: ReturnType<typeof setInterval> | null = null
let audioPacketCount = 0
let indicatorFrame = 0
let sttStatus = ''

function resetListenState(): void {
  committedPairs = []
  partialText = ''
  audioPacketCount = 0
  sttStatus = ''
  indicatorFrame = 0
  listenState = 'active'
  if (indicatorTimer !== null) { clearInterval(indicatorTimer); indicatorTimer = null }
}

function buildDisplayText(): string {
  if (listenState === 'paused') {
    let text = '|| PAUSED\n\nClick to resume\nDouble-click to exit'
    if (committedPairs.length > 0) {
      const last = committedPairs[committedPairs.length - 1]
      text += `\n\nLast: ${last.original.slice(0, 50)}`
      if (last.translation && !last.translation.startsWith('[ERR')) {
        text += `\n${last.translation.slice(0, 50)}`
      }
    }
    return text
  }

  const dots = '.'.repeat((indicatorFrame % 3) + 1).padEnd(3)
  const status = `Listening ${dots}`

  if (committedPairs.length === 0 && !partialText) {
    return `${status}\n\nSpeak now...`
  }

  const content = formatListenDisplay(committedPairs, partialText)
  return `${status}\n\n${content}`
}

function updateDisplay(): void {
  if (!currentBridge) return
  updateText(currentBridge, DISPLAY_ID, buildDisplayText())
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

function pauseListening(): void {
  listenState = 'paused'
  stopIndicator()
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch {}
  }
  sttClient?.disconnect()
  updateDisplay()
}

async function resumeListening(): Promise<void> {
  if (!currentBridge || !currentApi) return
  listenState = 'active'
  partialText = ''
  sttStatus = ''

  updateText(currentBridge, DISPLAY_ID, 'Resuming...')

  try {
    const { token } = await currentApi.getSttToken()
    sttClient = new SttClient(token, { language: appState.settings.listenLang })

    sttClient.onPartialTranscript((text) => {
      partialText = text
      updateDisplay()
    })

    sttClient.onCommittedTranscript((text) => {
      partialText = ''
      const sourceLang = appState.settings.listenLang
      const targetLang = appState.settings.translateLang

      currentApi!.translate(text, sourceLang, targetLang)
        .then((translated) => {
          committedPairs.push({ original: text, translation: translated })
          updateDisplay()
          // Save immediately to server
          if (appState.currentSessionId) {
            currentApi!.appendParagraph(appState.currentSessionId, text, translated).catch(() => {})
          }
        })
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err)
          committedPairs.push({ original: text, translation: `[ERR: ${errMsg.slice(0, 60)}]` })
          updateDisplay()
          // Save original even if translation failed
          if (appState.currentSessionId) {
            currentApi!.appendParagraph(appState.currentSessionId, text, '').catch(() => {})
          }
        })
    })

    sttClient.onError(() => {})
    sttClient.onStatus((msg) => { sttStatus = msg })

    sttClient.connect()
    currentBridge.audioControl(true)
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateText(currentBridge, DISPLAY_ID, `Error resuming: ${msg}\nClick to retry, Double-click to exit`)
    listenState = 'paused'
  }
}

function fullStop(): void {
  stopIndicator()
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch {}
  }
  sttClient?.disconnect()
  sttClient = null
}

export async function startListening(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('listen')
  currentBridge = bridge
  currentApi = api
  resetListenState()

  setPageContent(bridge, 'Connecting...')

  try {
    const session = await api.createSession(
      appState.settings.listenLang,
      appState.settings.translateLang
    )
    appState.currentSessionId = session.id

    const { token } = await api.getSttToken()

    sttClient = new SttClient(token, { language: appState.settings.listenLang })

    sttClient.onPartialTranscript((text) => {
      partialText = text
      updateDisplay()
    })

    sttClient.onCommittedTranscript((text) => {
      partialText = ''
      const sourceLang = appState.settings.listenLang
      const targetLang = appState.settings.translateLang

      api.translate(text, sourceLang, targetLang)
        .then((translated) => {
          committedPairs.push({ original: text, translation: translated })
          updateDisplay()
          // Save immediately to server
          if (appState.currentSessionId) {
            api.appendParagraph(appState.currentSessionId, text, translated).catch(() => {})
          }
        })
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err)
          committedPairs.push({ original: text, translation: `[ERR: ${errMsg.slice(0, 60)}]` })
          updateDisplay()
          // Save original even if translation failed
          if (appState.currentSessionId) {
            api.appendParagraph(appState.currentSessionId, text, '').catch(() => {})
          }
        })
    })

    sttClient.onError(() => {})
    sttClient.onStatus((msg) => { sttStatus = msg; updateDisplay() })

    sttClient.connect()
    bridge.audioControl(true)
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateText(bridge, DISPLAY_ID, `Error: ${msg}\nDouble-click to go back.`)
  }
}

export function handleListenEvent(
  bridge: any,
  eventType: number,
  api: ApiClient,
  onBack: () => void
): void {
  if (listenState === 'active') {
    // Click → pause
    if (eventType === 0) {
      pauseListening()
    }
  } else if (listenState === 'paused') {
    // Click → resume
    if (eventType === 0) {
      resumeListening()
    }
    // Double-click → exit to menu
    if (eventType === 3) {
      fullStop()
      onBack()
    }
  }
}

export function handleAudioData(pcmData: any): void {
  if (listenState !== 'active') return
  audioPacketCount++
  sttClient?.sendAudio(pcmData)
}
