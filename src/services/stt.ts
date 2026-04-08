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

  constructor(token: string, config: SttConfig) { this.token = token; this.config = config }

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
      vad_silence_threshold_secs: '1.0',
    })
    if (this.config.language && this.config.language !== 'auto') {
      params.set('language_code', this.config.language)
    }
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`

    this.emitStatus('Connecting...')
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.emitStatus('WS open')
    }

    this.ws.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : ''
      if (data) this._handleMessage(data)
    }

    this.ws.onerror = () => {
      this.emitStatus('WS error')
      this.errorCallbacks.forEach(cb => cb(new Error('WebSocket error')))
    }

    this.ws.onclose = (e) => {
      this.emitStatus(`Closed:${e.code}`)
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
        this.reconnectAttempts++
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

    // ElevenLabs requires JSON text frames with base64-encoded audio
    const message = JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: uint8ToBase64(bytes),
    })
    this.ws.send(message)
  }

  disconnect(): void {
    this.shouldReconnect = false
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
        return
      }

      if (type === 'partial_transcript' && msg.text) {
        this.partialCallbacks.forEach(cb => cb(msg.text))
        return
      }

      if ((type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') && msg.text) {
        this.committedCallbacks.forEach(cb => cb(msg.text))
        return
      }

      if (type === 'error') {
        this.emitStatus(`STT err: ${msg.message ?? JSON.stringify(msg)}`)
        return
      }

      this.emitStatus(`STT: ${type}`)
    } catch {
      this.emitStatus(`Parse err`)
    }
  }
}
