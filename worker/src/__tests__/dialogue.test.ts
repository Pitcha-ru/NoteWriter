import { describe, it, expect } from 'vitest'
import { buildOpenAIMessages, parseDialogueResponse } from '../dialogue'

describe('dialogue', () => {
  it('builds OpenAI messages with system prompt', () => {
    const messages = buildOpenAIMessages(
      [{ role: 'other', text: 'Πώς σας λένε;' }],
      'I am at a Greek exam',
      'My name is Alex, I live in Cyprus',
      'Greek',
      'Russian'
    )
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Alex')
    expect(messages[0].content).toContain('Greek')
    expect(messages[0].content).toContain('Russian')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('Πώς σας λένε;')
  })

  it('parses response separated by blank line', () => {
    const result = parseDialogueResponse('Με λένε Αλέξανδρος.\n\nМеня зовут Александрос.')
    expect(result.response).toBe('Με λένε Αλέξανδρος.')
    expect(result.translation).toBe('Меня зовут Александрос.')
  })

  it('parses response with RESPONSE/TRANSLATION markers (fallback)', () => {
    const result = parseDialogueResponse('RESPONSE: Με λένε Αλέξανδρος.\nTRANSLATION: Меня зовут Александрос.')
    expect(result.response).toBe('Με λένε Αλέξανδρος.')
    expect(result.translation).toBe('Меня зовут Александрос.')
  })

  it('returns full text if no separation found', () => {
    const result = parseDialogueResponse('Just a plain response')
    expect(result.response).toBe('Just a plain response')
    expect(result.translation).toBe('')
  })
})
