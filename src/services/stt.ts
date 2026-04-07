export interface SttConfig { language: string }
type TranscriptCallback = (text: string) => void
type ErrorCallback = (error: Error) => void

export class SttClient {
  private token: string
  private config: SttConfig
  private ws: WebSocket | null = null
  private partialCallbacks: TranscriptCallback[] = []
  private committedCallbacks: TranscriptCallback[] = []
  private errorCallbacks: ErrorCallback[] = []
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private shouldReconnect = false

  constructor(token: string, config: SttConfig) { this.token = token; this.config = config }

  onPartialTranscript(cb: TranscriptCallback): void { this.partialCallbacks.push(cb) }
  onCommittedTranscript(cb: TranscriptCallback): void { this.committedCallbacks.push(cb) }
  onError(cb: ErrorCallback): void { this.errorCallbacks.push(cb) }

  connect(): void {
    this.shouldReconnect = true
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/stream?token=${this.token}&language_code=${this.config.language}&encoding=pcm_s16le&sample_rate=16000`
    this.ws = new WebSocket(url)
    this.ws.onopen = () => { this.reconnectAttempts = 0 }
    this.ws.onmessage = (event) => { this._handleMessage(event.data as string) }
    this.ws.onerror = () => { this.errorCallbacks.forEach(cb => cb(new Error('WebSocket error'))) }
    this.ws.onclose = () => {
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
        this.reconnectAttempts++
        setTimeout(() => this.connect(), delay)
      }
    }
  }

  sendAudio(pcmData: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcmData)
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.ws?.close()
    this.ws = null
  }

  _handleMessage(data: string): void {
    try {
      const message = JSON.parse(data)
      if (message.type === 'PARTIAL_TRANSCRIPT' && message.text) {
        this.partialCallbacks.forEach(cb => cb(message.text))
      } else if (message.type === 'COMMITTED_TRANSCRIPT' && message.text) {
        this.committedCallbacks.forEach(cb => cb(message.text))
      }
    } catch { /* ignore */ }
  }
}
