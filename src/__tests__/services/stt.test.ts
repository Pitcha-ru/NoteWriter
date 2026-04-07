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
    client._handleMessage(JSON.stringify({ type: 'PARTIAL_TRANSCRIPT', text: 'Hello wor' }))
    expect(onPartial).toHaveBeenCalledWith('Hello wor')
    expect(onCommitted).not.toHaveBeenCalled()
  })

  it('emits committed transcripts via callback', () => {
    const client = new SttClient('test-token', { language: 'en' })
    const onCommitted = vi.fn()
    client.onCommittedTranscript(onCommitted)
    client._handleMessage(JSON.stringify({ type: 'COMMITTED_TRANSCRIPT', text: 'Hello world.' }))
    expect(onCommitted).toHaveBeenCalledWith('Hello world.')
  })
})
