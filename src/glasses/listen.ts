// src/glasses/listen.ts
import { setPageContent, updateText, formatListenDisplay } from './renderer'
import { appState } from '../services/state'
import { SttClient } from '../services/stt'
import { ApiClient } from '../services/api'

const DISPLAY_ID = 0
const SILENCE_THRESHOLD_MS = 2000

let sttClient: SttClient | null = null
let committedPairs: Array<{ original: string; translation: string }> = []
let partialText = ''

// Pending sentences waiting to be flushed as a paragraph
let pendingSentences: string[] = []
let pendingTranslations: string[] = []
let silenceTimer: ReturnType<typeof setTimeout> | null = null

let currentBridge: any = null
let currentApi: ApiClient | null = null

function resetListenState(): void {
  committedPairs = []
  partialText = ''
  pendingSentences = []
  pendingTranslations = []
  if (silenceTimer !== null) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
}

function updateDisplay(): void {
  if (!currentBridge) return
  const text = formatListenDisplay(committedPairs, partialText)
  updateText(currentBridge, DISPLAY_ID, text)
}

function scheduleSilenceFlush(): void {
  if (silenceTimer !== null) clearTimeout(silenceTimer)
  silenceTimer = setTimeout(() => {
    silenceTimer = null
    flushParagraph()
  }, SILENCE_THRESHOLD_MS)
}

function flushParagraph(): void {
  if (pendingSentences.length === 0) return
  const original = pendingSentences.join(' ')
  const translation = pendingTranslations.join(' ')
  pendingSentences = []
  pendingTranslations = []
  if (appState.currentSessionId && currentApi) {
    currentApi.appendParagraph(appState.currentSessionId, original, translation).catch(() => {})
  }
}

export async function startListening(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('listen')
  currentBridge = bridge
  currentApi = api
  resetListenState()

  // Show initial display
  setPageContent(bridge, 'Starting...')

  try {
    // Create session on server
    const session = await api.createSession(
      appState.settings.listenLang,
      appState.settings.translateLang
    )
    appState.currentSessionId = session.id

    // Get STT token
    const { token } = await api.getSttToken()

    // Start STT client
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
          pendingSentences.push(text)
          pendingTranslations.push(translated)
          updateDisplay()
          scheduleSilenceFlush()
        })
        .catch(() => {
          committedPairs.push({ original: text, translation: '' })
          pendingSentences.push(text)
          pendingTranslations.push('')
          updateDisplay()
          scheduleSilenceFlush()
        })
    })

    sttClient.onError(() => {
      // STT errors are non-fatal — reconnect is handled internally
    })

    sttClient.connect()

    // Enable audio capture
    bridge.audioControl(true)

    updateText(bridge, DISPLAY_ID, formatListenDisplay([], ''))
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
  if (eventType === 3) { // DOUBLE_CLICK
    stopListening()
    onBack()
  }
}

export function handleAudioData(pcmData: ArrayBuffer): void {
  sttClient?.sendAudio(pcmData)
}

function stopListening(): void {
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch { /* ignore */ }
  }
  flushParagraph()
  sttClient?.disconnect()
  sttClient = null
  if (silenceTimer !== null) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
}
