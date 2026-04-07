import { describe, it, expect } from 'vitest'
import { buildTokenRequest } from '../stt-token'

describe('stt-token', () => {
  it('builds correct ElevenLabs token request', () => {
    const { url, options } = buildTokenRequest('el-key-123', 'https://api.elevenlabs.io')
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text/get-websocket-token')
    expect(options.method).toBe('GET')
    expect(options.headers['xi-api-key']).toBe('el-key-123')
  })
})
