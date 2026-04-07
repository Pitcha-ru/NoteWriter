import type { Settings, Session, Paragraph, SessionListResponse, SessionDetailResponse, MaskedKeys, ApiKeys } from '../types'

// Convert snake_case keys to camelCase (recursive)
function toCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(toCamel)
  if (obj === null || typeof obj !== 'object') return obj
  const out: any = {}
  for (const key of Object.keys(obj)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    out[camel] = toCamel(obj[key])
  }
  return out
}

// Convert camelCase keys to snake_case (one level deep)
function toSnake(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj
  const out: any = {}
  for (const key of Object.keys(obj)) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    out[snake] = obj[key]
  }
  return out
}

export class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) { this.baseUrl = baseUrl }

  setToken(token: string): void { this.token = token }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(), ...options.headers as Record<string, string> },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' })) as { error: string }
      throw new Error(body.error)
    }
    const data = await response.json()
    return toCamel(data) as T
  }

  async register(deviceId: string): Promise<{ token: string }> {
    return this.request('/api/register', { method: 'POST', body: JSON.stringify({ device_id: deviceId }) })
  }
  async getSttToken(): Promise<{ token: string }> {
    return this.request('/api/stt-token', { method: 'POST' })
  }
  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const r = await this.request<{ translatedText: string }>('/api/translate', {
      method: 'POST', body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
    })
    return r.translatedText
  }
  async listSessions(cursor?: string, limit = 20): Promise<SessionListResponse> {
    const p = new URLSearchParams({ limit: String(limit) })
    if (cursor) p.set('cursor', cursor)
    return this.request(`/api/sessions?${p}`)
  }
  async getSession(id: string, cursor?: number, limit = 50): Promise<SessionDetailResponse> {
    const p = new URLSearchParams({ limit: String(limit) })
    if (cursor !== undefined) p.set('cursor', String(cursor))
    return this.request(`/api/sessions/${id}?${p}`)
  }
  async createSession(listenLang: string, translateLang: string): Promise<Session> {
    return this.request('/api/sessions', { method: 'POST', body: JSON.stringify({ listen_lang: listenLang, translate_lang: translateLang }) })
  }
  async appendParagraph(sessionId: string, original: string, translation: string): Promise<Paragraph> {
    return this.request(`/api/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ original, translation }) })
  }
  async deleteSession(id: string): Promise<void> { await this.request(`/api/sessions/${id}`, { method: 'DELETE' }) }
  async getKeys(): Promise<MaskedKeys> { return this.request('/api/keys') }
  async saveKeys(keys: ApiKeys): Promise<void> { await this.request('/api/keys', { method: 'PUT', body: JSON.stringify(toSnake(keys)) }) }
  async deleteKeys(): Promise<void> { await this.request('/api/keys', { method: 'DELETE' }) }
  async getSettings(): Promise<Settings> { return this.request('/api/settings') }
  async saveSettings(settings: Settings): Promise<void> { await this.request('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }) }
}
