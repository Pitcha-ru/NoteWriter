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

// Filter out non-speech sounds like (sound of falling), [music], etc.
function isNoise(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  // Matches text wrapped in parentheses, brackets, or similar
  if (/^\(.*\)$/.test(t)) return true
  if (/^\[.*\]$/.test(t)) return true
  if (/^\{.*\}$/.test(t)) return true
  // Common noise markers
  if (/^[*].*[*]$/.test(t)) return true
  return false
}

function buildDisplayText(): string {
  if (listenState === 'paused') {
    let text = '|| PAUSED\nClick = resume\nDouble-click = exit'
    if (committedPairs.length > 0) {
      const last = committedPairs[committedPairs.length - 1]
      text += `\n\n${last.original.slice(0, 60)}`
      if (last.translation && !last.translation.startsWith('[ERR')) {
        text += `\n${last.translation.slice(0, 60)}`
      }
    }
    return text
  }

  // Blinking dot indicator
  const dot = indicatorFrame % 2 === 0 ? '*' : ' '

  if (committedPairs.length === 0 && !partialText) {
    return `${dot} Speak now...`
  }

  return formatListenDisplay(committedPairs, partialText, dot)
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
      if (isNoise(text)) return
      const pairIndex = committedPairs.length
      committedPairs.push({ original: text, translation: '' })
      updateDisplay()

      let savedParagraphId: string | null = null
      if (appState.currentSessionId) {
        currentApi!.appendParagraph(appState.currentSessionId, text, '')
          .then((para) => { savedParagraphId = para.id })
          .catch(() => {})
      }

      const sourceLang = appState.settings.listenLang
      const targetLang = appState.settings.translateLang
      currentApi!.translate(text, sourceLang, targetLang)
        .then((translated) => {
          committedPairs[pairIndex].translation = translated
          updateDisplay()
          if (savedParagraphId) {
            currentApi!.updateParagraphTranslation(savedParagraphId, translated).catch(() => {})
          }
        })
        .catch(() => {})
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
    window.dispatchEvent(new CustomEvent('notewriter:session-created'))

    const { token } = await api.getSttToken()

    sttClient = new SttClient(token, { language: appState.settings.listenLang })

    sttClient.onPartialTranscript((text) => {
      if (isNoise(text)) return
      partialText = text
      updateDisplay()
    })

    sttClient.onCommittedTranscript((text) => {
      partialText = ''
      if (isNoise(text)) return

      // Show original immediately on display
      const pairIndex = committedPairs.length
      committedPairs.push({ original: text, translation: '' })
      updateDisplay()

      // Save to server immediately (without translation)
      let savedParagraphId: string | null = null
      if (appState.currentSessionId) {
        api.appendParagraph(appState.currentSessionId, text, '')
          .then((para) => {
            savedParagraphId = para.id
            window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
          })
          .catch(() => {})
      }

      // Translate in background, update display + server when done
      const sourceLang = appState.settings.listenLang
      const targetLang = appState.settings.translateLang
      api.translate(text, sourceLang, targetLang)
        .then((translated) => {
          committedPairs[pairIndex].translation = translated
          updateDisplay()
          // Update paragraph with translation
          if (savedParagraphId) {
            api.updateParagraphTranslation(savedParagraphId, translated).catch(() => {})
          }
        })
        .catch(() => {
          // Translation failed — original is already saved
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
  // Double-click from ANY state → exit to menu
  if (eventType === 3) {
    fullStop()
    onBack()
    return
  }
  if (listenState === 'active') {
    if (eventType === 0) pauseListening() // Click → pause
  } else if (listenState === 'paused') {
    if (eventType === 0) resumeListening() // Click → resume
  }
}

export function handleAudioData(pcmData: any): void {
  if (listenState !== 'active') return
  audioPacketCount++
  sttClient?.sendAudio(pcmData)
}
