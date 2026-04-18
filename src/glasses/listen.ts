// src/glasses/listen.ts
import { setPageContent, updateText, formatListenDisplay, setSplitLayout, updateTop, updateBottom } from './renderer'
import { appState } from '../services/state'
import { SttClient } from '../services/stt'
import { ApiClient } from '../services/api'
import { log } from '../services/logger'

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
  saveQueue = Promise.resolve()
  if (indicatorTimer !== null) { clearInterval(indicatorTimer); indicatorTimer = null }
}

// Filter out non-speech sounds like (sound of falling), [music], etc.
// Split long text into sentence-sized chunks (~100 chars each)
function splitIntoChunks(text: string, maxLen = 120): string[] {
  if (text.length <= maxLen) return [text]
  // Try splitting on sentence boundaries first
  const sentences = text.match(/[^.!?;]+[.!?;]+\s*/g)
  if (sentences && sentences.length > 1) {
    const chunks: string[] = []
    let current = ''
    for (const s of sentences) {
      if (current.length + s.length > maxLen && current) {
        chunks.push(current.trim())
        current = s
      } else {
        current += s
      }
    }
    if (current.trim()) chunks.push(current.trim())
    if (chunks.length > 1) return chunks
  }
  // Fallback: split on word boundaries when no punctuation found
  const words = text.split(/\s+/)
  const chunks: string[] = []
  let current = ''
  for (const w of words) {
    if (current.length + w.length + 1 > maxLen && current) {
      chunks.push(current)
      current = w
    } else {
      current = current ? current + ' ' + w : w
    }
  }
  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : [text]
}

// Sequential save queue — ensures paragraphs are saved in order
let saveQueue: Promise<any> = Promise.resolve()

function enqueueSave(fn: () => Promise<any>): void {
  saveQueue = saveQueue.then(fn, fn) // continue even if previous failed
}

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

function buildTranscriptText(): string {
  const dot = indicatorFrame % 2 === 0 ? '*' : ' '
  const originals = committedPairs.map(p => p.original)
  if (partialText) originals.push(`${dot} ${partialText}`)
  else if (originals.length === 0) originals.push(`${dot} Speak now...`)
  return originals.join('\n')
}

function buildTranslationText(): string {
  const translations = committedPairs
    .map(p => p.translation)
    .filter(t => t && !t.startsWith('[ERR'))
  return translations.join('\n') || ''
}

function updateDisplay(): void {
  if (!currentBridge) return
  if (listenState === 'paused') {
    // Paused — use single-container display
    let text = '|| PAUSED\nClick = resume\nDouble-click = exit'
    if (committedPairs.length > 0) {
      const last = committedPairs[committedPairs.length - 1]
      text += `\n\n${last.original.slice(0, 60)}`
      if (last.translation) text += `\n${last.translation.slice(0, 60)}`
    }
    setPageContent(currentBridge, text)
    return
  }
  // Active — split screen: top=transcript, bottom=translation
  updateTop(currentBridge, buildTranscriptText())
  updateBottom(currentBridge, buildTranslationText())
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
  log('SESSION', 'Paused')
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
  log('SESSION', 'Resumed')
  listenState = 'active'
  partialText = ''
  sttStatus = ''

  setSplitLayout(currentBridge, 'Resuming...', '')

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
      const chunks = splitIntoChunks(text)
      const sourceLang = appState.settings.listenLang
      const targetLang = appState.settings.translateLang
      for (const chunk of chunks) {
        const idx = committedPairs.length
        committedPairs.push({ original: chunk, translation: '' })
        log('STT', `Chunk queued for translation: "${chunk.slice(0, 60)}" ${sourceLang}>${targetLang}`)
        updateDisplay()

        const saveP = new Promise<string | null>((resolve) => {
          enqueueSave(async () => {
            const sessionId = appState.currentSessionId
            if (sessionId) {
              try {
                const p = await currentApi!.appendParagraph(sessionId, chunk, '')
                log('SAVE', `Paragraph saved id=${p.id}`)
                resolve(p.id)
                return
              } catch (e) { log('ERR', `Paragraph save failed: ${e instanceof Error ? e.message : String(e)}`) }
            }
            resolve(null)
          })
        })

        const translateStart = Date.now()
        currentApi!.translate(chunk, sourceLang, targetLang, appState.settings.translateProvider, appState.settings.translateModel)
          .then(async (translated) => {
            if (translated) {
              log('TRANSLATE', `Response: "${translated.slice(0, 60)}" (${Date.now() - translateStart}ms)`)
              committedPairs[idx].translation = translated
              updateDisplay()
              const paraId = await saveP
              if (paraId) currentApi!.updateParagraphTranslation(paraId, translated).catch((e) => { log('ERR', `Translation update failed: ${e instanceof Error ? e.message : String(e)}`) })
            }
          })
          .catch((e) => { log('ERR', `Translation failed: ${e instanceof Error ? e.message : String(e)}`) })
      }
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
  log('SESSION', 'Stopped')
  stopIndicator()
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch {}
  }
  sttClient?.disconnect()
  sttClient = null
  listenState = 'active'
}

/** Reset all listen module state — call when returning to menu */
export function resetListen(): void {
  fullStop()
  resetListenState()
  currentBridge = null  // prevent stale promises from overwriting display
  currentApi = null
}

export async function startListening(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('listen')
  currentBridge = bridge
  currentApi = api
  resetListenState()

  setSplitLayout(bridge, 'Connecting...', '')

  try {
    const session = await api.createSession(
      appState.settings.listenLang,
      appState.settings.translateLang
    )
    appState.currentSessionId = session.id
    log('SESSION', `Created id=${session.id}, ${appState.settings.listenLang}>${appState.settings.translateLang}`)
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

      const chunks = splitIntoChunks(text)
      const sourceLang = appState.settings.listenLang
      const targetLang = appState.settings.translateLang

      for (const chunk of chunks) {
        const idx = committedPairs.length
        committedPairs.push({ original: chunk, translation: '' })
        log('STT', `Chunk queued for translation: "${chunk.slice(0, 60)}" ${sourceLang}>${targetLang}`)
        updateDisplay()

        // Save sequentially (queue ensures correct order)
        const savePromise = new Promise<string | null>((resolve) => {
          enqueueSave(async () => {
            const sessionId = appState.currentSessionId
            if (sessionId) {
              try {
                const p = await api.appendParagraph(sessionId, chunk, '')
                log('SAVE', `Paragraph saved id=${p.id}`)
                window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
                resolve(p.id)
                return
              } catch (e) { log('ERR', `Paragraph save failed: ${e instanceof Error ? e.message : String(e)}`) }
            }
            resolve(null)
          })
        })

        // Translate in parallel (don't wait in queue)
        const translateStart = Date.now()
        api.translate(chunk, sourceLang, targetLang, appState.settings.translateProvider, appState.settings.translateModel)
          .then(async (translated) => {
            if (translated) {
              log('TRANSLATE', `Response: "${translated.slice(0, 60)}" (${Date.now() - translateStart}ms)`)
              committedPairs[idx].translation = translated
              updateDisplay()
              const paraId = await savePromise
              if (paraId) api.updateParagraphTranslation(paraId, translated).catch((e) => { log('ERR', `Translation update failed: ${e instanceof Error ? e.message : String(e)}`) })
            }
          })
          .catch((e) => { log('ERR', `Translation failed: ${e instanceof Error ? e.message : String(e)}`) })
      }
    })

    sttClient.onError(() => {})
    sttClient.onStatus((msg) => { sttStatus = msg; updateDisplay() })

    sttClient.connect()
    bridge.audioControl(true)
    log('SESSION', 'Start listening')
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('ERR', `Start listening failed: ${msg}`)
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
