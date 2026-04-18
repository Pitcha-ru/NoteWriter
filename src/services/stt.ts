import { log } from './logger'

export interface SttConfig { language: string }
type TranscriptCallback = (text: string) => void
type StatusCallback = (status: string) => void
type ErrorCallback = (error: Error) => void

// Base64 encode helper for Uint8Array
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export class SttClient {
  private token: string
  private config: SttConfig
  private ws: WebSocket | null = null
  private partialCallbacks: TranscriptCallback[] = []
  private committedCallbacks: TranscriptCallback[] = []
  private errorCallbacks: ErrorCallback[] = []
  private statusCallbacks: StatusCallback[] = []
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private shouldReconnect = false
  private lastTranscriptTime = 0
  private audioPacketsSinceLastTranscript = 0

  // Session stats
  private sessionStartTime = 0
  private totalAudioPackets = 0
  private totalPartials = 0
  private totalCommits = 0
  private gapCount = 0
  private maxGapMs = 0
  private totalGapMs = 0
  private partialIntervals: number[] = []

  constructor(token: string, config: SttConfig) { this.token = token; this.config = config }

  private resetStats(): void {
    this.sessionStartTime = Date.now()
    this.totalAudioPackets = 0
    this.totalPartials = 0
    this.totalCommits = 0
    this.gapCount = 0
    this.maxGapMs = 0
    this.totalGapMs = 0
    this.partialIntervals = []
    this.lastTranscriptTime = 0
    this.audioPacketsSinceLastTranscript = 0
  }

  private logStats(): void {
    const duration = ((Date.now() - this.sessionStartTime) / 1000).toFixed(1)
    const avgInterval = this.partialIntervals.length > 0
      ? (this.partialIntervals.reduce((a, b) => a + b, 0) / this.partialIntervals.length).toFixed(0)
      : '-'
    const maxInterval = this.partialIntervals.length > 0
      ? Math.max(...this.partialIntervals).toFixed(0)
      : '-'
    log('STATS', `Session ${duration}s | audio_pkts=${this.totalAudioPackets} partials=${this.totalPartials} commits=${this.totalCommits} | gaps(>2s)=${this.gapCount} max_gap=${(this.maxGapMs / 1000).toFixed(1)}s total_gap=${(this.totalGapMs / 1000).toFixed(1)}s | partial_interval avg=${avgInterval}ms max=${maxInterval}ms`)
  }

  onPartialTranscript(cb: TranscriptCallback): void { this.partialCallbacks.push(cb) }
  onCommittedTranscript(cb: TranscriptCallback): void { this.committedCallbacks.push(cb) }
  onError(cb: ErrorCallback): void { this.errorCallbacks.push(cb) }
  onStatus(cb: StatusCallback): void { this.statusCallbacks.push(cb) }

  private emitStatus(msg: string): void {
    this.statusCallbacks.forEach(cb => cb(msg))
  }

  connect(): void {
    this.shouldReconnect = true

    // ElevenLabs Scribe v2 Realtime WebSocket with VAD auto-commit
    const params = new URLSearchParams({
      model_id: 'scribe_v2_realtime',
      token: this.token,
      audio_format: 'pcm_16000',
      commit_strategy: 'vad',
      vad_silence_threshold_secs: '0.5',
    })
    if (this.config.language && this.config.language !== 'auto') {
      params.set('language_code', this.config.language)
    }
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`

    this.emitStatus('Connecting...')
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.resetStats()
      this.emitStatus('WS open')
      log('STT', 'WebSocket connected')
    }

    this.ws.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : ''
      if (data) this._handleMessage(data)
    }

    this.ws.onerror = () => {
      this.emitStatus('WS error')
      log('ERR', 'STT WebSocket error')
      this.errorCallbacks.forEach(cb => cb(new Error('WebSocket error')))
    }

    this.ws.onclose = (e) => {
      this.emitStatus(`Closed:${e.code}`)
      log('STT', `WebSocket closed: ${e.code}`)
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
        this.reconnectAttempts++
        log('STT', `Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
        setTimeout(() => this.connect(), delay)
      }
    }
  }

  sendAudio(pcmData: any): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return

    // Convert to Uint8Array
    let bytes: Uint8Array
    if (pcmData instanceof Uint8Array) {
      bytes = pcmData
    } else if (pcmData instanceof ArrayBuffer) {
      bytes = new Uint8Array(pcmData)
    } else if (Array.isArray(pcmData)) {
      bytes = new Uint8Array(pcmData)
    } else {
      return
    }

    this.audioPacketsSinceLastTranscript++
    this.totalAudioPackets++

    // ElevenLabs requires JSON text frames with base64-encoded audio
    const message = JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: uint8ToBase64(bytes),
    })
    this.ws.send(message)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.sessionStartTime > 0 && this.totalPartials > 0) this.logStats()
    this.ws?.close()
    this.ws = null
  }

  getWsState(): string {
    if (!this.ws) return 'null'
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']
    return states[this.ws.readyState] ?? `?(${this.ws.readyState})`
  }

  _handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data)
      const type = msg.message_type ?? msg.type ?? ''

      if (type === 'session_started') {
        this.emitStatus('Session OK')
        log('STT', 'Session started')
        return
      }

      if (type === 'partial_transcript' && msg.text) {
        const now = Date.now()
        this.totalPartials++
        if (this.lastTranscriptTime > 0) {
          const interval = now - this.lastTranscriptTime
          this.partialIntervals.push(interval)
          if (interval > 2000) {
            this.gapCount++
            this.totalGapMs += interval
            if (interval > this.maxGapMs) this.maxGapMs = interval
            log('STT', `GAP ${(interval / 1000).toFixed(1)}s between partials (${this.audioPacketsSinceLastTranscript} audio packets sent during gap)`)
          }
        }
        this.lastTranscriptTime = now
        this.audioPacketsSinceLastTranscript = 0
        log('STT', `Partial transcript (len=${msg.text.length})`)
        this.partialCallbacks.forEach(cb => cb(msg.text))
        return
      }

      if ((type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') && msg.text) {
        this.lastTranscriptTime = Date.now()
        this.audioPacketsSinceLastTranscript = 0
        this.totalCommits++
        log('STT', `Committed: "${msg.text.slice(0, 80)}" (len=${msg.text.length})`)
        this.committedCallbacks.forEach(cb => cb(msg.text))
        return
      }

      if (type === 'error') {
        const errMsg = msg.message ?? JSON.stringify(msg)
        this.emitStatus(`STT err: ${errMsg}`)
        log('ERR', `STT error: ${errMsg}`)
        return
      }

      this.emitStatus(`STT: ${type}`)
    } catch {
      this.emitStatus(`Parse err`)
      log('ERR', 'STT message parse error')
    }
  }
}
