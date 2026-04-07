import { describe, it, expect, vi } from 'vitest'
import { SttClient } from '../../services/stt'

describe('SttClient', () => {
  it('constructs with token and config', () => {
    const client = new SttClient('test-token', { language: 'en' })
    expect(client).toBeDefined()
  })

  it('emits partial transcripts via callback', () => {
    const client = new SttClient('test-token', { language: 'en' })
    const onPartial = vi.fn()
    const onCommitted = vi.fn()
    client.onPartialTranscript(onPartial)
    client.onCommittedTranscript(onCommitted)
    // ElevenLabs Scribe v2 uses message_type (lowercase)
    client._handleMessage(JSON.stringify({ message_type: 'partial_transcript', text: 'Hello wor' }))
    expect(onPartial).toHaveBeenCalledWith('Hello wor')
    expect(onCommitted).not.toHaveBeenCalled()
  })

  it('emits committed transcripts via callback', () => {
    const client = new SttClient('test-token', { language: 'en' })
    const onCommitted = vi.fn()
    client.onCommittedTranscript(onCommitted)
    client._handleMessage(JSON.stringify({ message_type: 'committed_transcript', text: 'Hello world.' }))
    expect(onCommitted).toHaveBeenCalledWith('Hello world.')
  })

  it('handles session_started without error', () => {
    const client = new SttClient('test-token', { language: 'en' })
    const onStatus = vi.fn()
    client.onStatus(onStatus)
    client._handleMessage(JSON.stringify({ message_type: 'session_started' }))
    expect(onStatus).toHaveBeenCalledWith('Session OK')
  })
})
