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
    // Trim history to max 15 turns
    if (conversationHistory.length > 15) conversationHistory = conversationHistory.slice(-15)

    api.translate(text, appState.settings.listenLang, appState.settings.translateLang)
      .then((translated) => {
        committedPairs.push({ original: text, translation: translated })
        updateDisplay()
        if (appState.currentSessionId) {
          api.appendParagraph(appState.currentSessionId, text, translated)
            .then(() => window.dispatchEvent(new CustomEvent('notewriter:session-updated')))
            .catch(() => {})
        }
      })
      .catch(() => {
        committedPairs.push({ original: text, translation: '' })
        updateDisplay()
        if (appState.currentSessionId) {
          api.appendParagraph(appState.currentSessionId, text, '').catch(() => {})
        }
      })
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
  switch (dialogueState) {
    case 'listening':
      if (eventType === 0 && conversationHistory.length > 0) generateAnswer()
      break
    case 'showing_answer':
      if (eventType === 0) {
        dialogueState = 'listening'
        committedPairs = []
        partialText = ''
        startAudio(api).then(() => { startIndicator(); updateDisplay() })
      }
      if (eventType === 3) { dialogueState = 'paused'; updateDisplay() }
      break
    case 'paused':
      if (eventType === 0) {
        dialogueState = 'listening'
        committedPairs = []
        partialText = ''
        startAudio(api).then(() => { startIndicator(); updateDisplay() })
      }
      if (eventType === 3) { stopIndicator(); stopAudio(); onBack() }
      break
    case 'generating':
      break
  }
}

export function handleDialogueAudio(pcmData: any): void {
  if (dialogueState !== 'listening') return
  sttClient?.sendAudio(pcmData)
}
