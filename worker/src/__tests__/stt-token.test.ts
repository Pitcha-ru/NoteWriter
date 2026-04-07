import { describe, it, expect, vi } from 'vitest'
import { buildTokenRequest, mintSttToken } from '../stt-token'

describe('stt-token', () => {
  it('builds correct ElevenLabs token request', () => {
    const { url, options } = buildTokenRequest('el-key-123', 'https://api.elevenlabs.io')
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text/get-websocket-token')
    expect(options.method).toBe('GET')
    expect(options.headers['xi-api-key']).toBe('el-key-123')
  })
})

describe('mintSttToken', () => {
  it('returns token on success', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ token: 'temp-token-123' })))
    const result = await mintSttToken('api-key', 'https://api.elevenlabs.io')
    expect(result).toEqual({ token: 'temp-token-123' })
  })

  it('returns error on failure', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
    const result = await mintSttToken('bad-key', 'https://api.elevenlabs.io')
    expect('error' in result).toBe(true)
  })
})
