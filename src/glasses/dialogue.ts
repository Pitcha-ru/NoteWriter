// src/glasses/dialogue.ts
import { setPageContent, updateText, formatListenDisplay } from './renderer'
import { appState } from '../services/state'
import { SttClient } from '../services/stt'
import { ApiClient } from '../services/api'
import type { DialogueMessage } from '../types'

const DISPLAY_ID = 0
type DialogueState = 'listening' | 'generating' | 'showing_answer' | 'paused'

let sttClient: SttClient | null = null
let currentBridge: any = null
let currentApi: ApiClient | null = null
let dialogueState: DialogueState = 'listening'
let conversationHistory: DialogueMessage[] = []
let committedPairs: Array<{ original: string; translation: string }> = []
let partialText = ''
let lastAnswer = { response: '', translation: '' }
let indicatorTimer: ReturnType<typeof setInterval> | null = null
let indicatorFrame = 0

let saveQueue: Promise<any> = Promise.resolve()

function enqueueSave(fn: () => Promise<any>): void {
  saveQueue = saveQueue.then(fn, fn)
}

function splitIntoChunks(text: string, maxLen = 120): string[] {
  if (text.length <= maxLen) return [text]
  const sentences = text.match(/[^.!?;]+[.!?;]+\s*/g) || [text]
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
  return chunks.length > 0 ? chunks : [text]
}

function isNoise(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^\(.*\)$/.test(t) || /^\[.*\]$/.test(t) || /^\{.*\}$/.test(t) || /^[*].*[*]$/.test(t)) return true
  return false
}

function resetState(): void {
  conversationHistory = []
  committedPairs = []
  partialText = ''
  lastAnswer = { response: '', translation: '' }
  dialogueState = 'listening'
  indicatorFrame = 0
  saveQueue = Promise.resolve()
  if (indicatorTimer) { clearInterval(indicatorTimer); indicatorTimer = null }
}

function buildDisplay(): string {
  if (dialogueState === 'generating') {
    const last = committedPairs.length > 0 ? committedPairs[committedPairs.length - 1] : null
    let text = 'Generating...'
    if (last) {
      text += `\n\nQ: ${last.original.slice(0, 80)}`
      if (last.translation) text += `\n(${last.translation.slice(0, 80)})`
    }
    return text
  }
  if (dialogueState === 'showing_answer') {
    let text = `> ${lastAnswer.response}`
    if (lastAnswer.translation) text += `\n\n${lastAnswer.translation}`
    text += '\n\nClick = continue'
    return text
  }
  if (dialogueState === 'paused') {
    let text = '|| PAUSED\nClick = resume\nDouble-click = exit'
    if (lastAnswer.response) text += `\n\n> ${lastAnswer.response.slice(0, 60)}`
    return text
  }
  // listening
  const dot = indicatorFrame % 2 === 0 ? '*' : ' '
  if (committedPairs.length === 0 && !partialText) return `${dot} Speak now...`
  return formatListenDisplay(committedPairs, partialText, dot)
}

function updateDisplay(): void {
  if (!currentBridge) return
  updateText(currentBridge, DISPLAY_ID, buildDisplay())
}

function startIndicator(): void {
  if (indicatorTimer) return
  indicatorTimer = setInterval(() => { indicatorFrame++; updateDisplay() }, 500)
}

function stopIndicator(): void {
  if (indicatorTimer) { clearInterval(indicatorTimer); indicatorTimer = null }
}

function stopAudio(): void {
  if (currentBridge) { try { currentBridge.audioControl(false) } catch {} }
  sttClient?.disconnect()
  sttClient = null
}

/** Reset all dialogue module state — call when returning to menu */
export function resetDialogue(): void {
  stopIndicator()
  stopAudio()
  resetState()
  currentBridge = null
  currentApi = null
}

async function startAudio(api: ApiClient): Promise<void> {
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
    conversationHistory.push({ role: 'other', text })
    if (conversationHistory.length > 15) conversationHistory = conversationHistory.slice(-15)

    const chunks = splitIntoChunks(text)
    for (const chunk of chunks) {
      const idx = committedPairs.length
      committedPairs.push({ original: chunk, translation: '' })
      updateDisplay()

      enqueueSave(async () => {
        const sessionId = appState.currentSessionId
        let paraId: string | null = null
        if (sessionId) {
          try {
            const p = await api.appendParagraph(sessionId, chunk, '')
            paraId = p.id
            window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
          } catch {}
        }
        try {
          const translated = await api.translate(chunk, appState.settings.listenLang, appState.settings.translateLang)
          if (translated) {
            committedPairs[idx].translation = translated
            updateDisplay()
            if (paraId) api.updateParagraphTranslation(paraId, translated).catch(() => {})
          }
        } catch {}
      })
    }
  })

  sttClient.onError(() => {})
  sttClient.onStatus(() => {})
  sttClient.connect()
  currentBridge.audioControl(true)
}

async function generateAnswer(): Promise<void> {
  dialogueState = 'generating'
  stopIndicator()
  stopAudio()
  updateDisplay()

  try {
    const result = await currentApi!.generateDialogue(
      conversationHistory,
      appState.settings.context,
      appState.settings.persona,
      appState.settings.listenLang,
      appState.settings.translateLang
    )
    lastAnswer = result
    conversationHistory.push({ role: 'self', text: result.response })
    // Trim history to max 15 turns
    if (conversationHistory.length > 15) conversationHistory = conversationHistory.slice(-15)

    if (appState.currentSessionId) {
      currentApi!.appendParagraph(appState.currentSessionId, `[AI] ${result.response}`, result.translation)
        .then(() => window.dispatchEvent(new CustomEvent('notewriter:session-updated')))
        .catch(() => {})
    }

    dialogueState = 'showing_answer'
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateText(currentBridge, DISPLAY_ID, `Error: ${msg.slice(0, 100)}\nClick = retry\nDouble-click = exit`)
    dialogueState = 'paused'
  }
}

export async function startDialogue(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('dialogue')
  currentBridge = bridge
  currentApi = api
  resetState()
  setPageContent(bridge, 'Connecting...')

  try {
    const session = await api.createSession(appState.settings.listenLang, appState.settings.translateLang, 'dialogue')
    appState.currentSessionId = session.id
    window.dispatchEvent(new CustomEvent('notewriter:session-created'))
    await startAudio(api)
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateText(bridge, DISPLAY_ID, `Error: ${msg}\nDouble-click to go back.`)
    dialogueState = 'paused'
  }
}

export function handleDialogueEvent(bridge: any, eventType: number, api: ApiClient, onBack: () => void): void {
  // Double-click from ANY state → exit to menu
  if (eventType === 3) {
    stopIndicator()
    stopAudio()
    onBack()
    return
  }

  switch (dialogueState) {
    case 'listening':
      if (eventType === 0) {
        // Use partial text if no committed text yet
        if (partialText && !isNoise(partialText)) {
          conversationHistory.push({ role: 'other', text: partialText })
          if (conversationHistory.length > 15) conversationHistory = conversationHistory.slice(-15)
          partialText = ''
        }
        if (conversationHistory.length > 0) generateAnswer()
      }
      break
    case 'showing_answer':
      if (eventType === 0) {
        dialogueState = 'listening'
        committedPairs = []
        partialText = ''
        startAudio(api).then(() => { startIndicator(); updateDisplay() })
      }
      break
    case 'paused':
      if (eventType === 0) {
        dialogueState = 'listening'
        committedPairs = []
        partialText = ''
        startAudio(api).then(() => { startIndicator(); updateDisplay() })
      }
      break
    case 'generating':
      break
  }
}

export function handleDialogueAudio(pcmData: any): void {
  if (dialogueState !== 'listening') return
  sttClient?.sendAudio(pcmData)
}
