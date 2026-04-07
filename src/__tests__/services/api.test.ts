import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiClient } from '../../services/api'

describe('ApiClient', () => {
  let client: ApiClient
  beforeEach(() => {
    client = new ApiClient('https://worker.example.com')
    global.fetch = vi.fn()
  })

  it('register sends device_id and returns token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ token: 'abc123' }), { status: 201 }))
    const result = await client.register('device-1')
    expect(result).toEqual({ token: 'abc123' })
    expect(fetch).toHaveBeenCalledWith('https://worker.example.com/api/register', expect.objectContaining({ method: 'POST', body: JSON.stringify({ device_id: 'device-1' }) }))
  })

  it('translate sends text and returns translation', async () => {
    client.setToken('token123')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ translated_text: 'Bonjour' })))
    const result = await client.translate('Hello', 'en', 'fr')
    expect(result).toBe('Bonjour')
  })

  it('includes auth header on authenticated requests', async () => {
    client.setToken('mytoken')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ listenLang: 'en', translateLang: 'el' })))
    await client.getSettings()
    expect(fetch).toHaveBeenCalledWith('https://worker.example.com/api/settings', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mytoken' }) }))
  })
})
