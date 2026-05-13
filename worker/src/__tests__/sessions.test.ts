import { describe, it, expect, beforeEach } from 'vitest'
import { createSession, listSessions, appendParagraph, deleteSession } from '../sessions'
import type { Session, Paragraph } from '../sessions'
import worker from '../index'

function createMockD1() {
  const sessions: Map<string, Session> = new Map()
  const paragraphs: Map<string, Paragraph> = new Map() // keyed by paragraph id

  function getSessionParagraphs(sessionId: string): Paragraph[] {
    return Array.from(paragraphs.values()).filter(p => p.session_id === sessionId)
  }

  return {
    prepare(query: string) {
      // Normalise for pattern matching
      const q = query.trim().replace(/\s+/g, ' ').toUpperCase()

      return {
        bind(...args: unknown[]) {
          return {
            async first<T = unknown>(): Promise<T | null> {
              // SELECT * FROM sessions WHERE id = ? AND device_id = ?
              if (q.startsWith('SELECT * FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                return (s && s.device_id === deviceId ? s : null) as T | null
              }
              // SELECT id FROM sessions WHERE id = ? AND device_id = ?
              if (q.startsWith('SELECT ID FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                return (s && s.device_id === deviceId ? { id: s.id } : null) as T | null
              }
              // SELECT * FROM sessions WHERE id = ?
              if (q.startsWith('SELECT * FROM SESSIONS WHERE ID = ?')) {
                return (sessions.get(args[0] as string) ?? null) as T | null
              }
              // SELECT position FROM paragraphs WHERE id = ?  (after INSERT ... SELECT)
              if (q.startsWith('SELECT POSITION FROM PARAGRAPHS WHERE ID = ?')) {
                const p = paragraphs.get(args[0] as string)
                return (p ? { position: p.position } : null) as T | null
              }
              return null
            },

            async all<T = unknown>(): Promise<{ results: T[] }> {
              // SELECT * FROM sessions WHERE device_id = ? [AND cursor] ORDER BY … LIMIT ?
              if (q.startsWith('SELECT * FROM SESSIONS WHERE DEVICE_ID = ?')) {
                const deviceId = args[0] as string
                let filtered = Array.from(sessions.values()).filter(s => s.device_id === deviceId)

                // cursor: AND (created_at < ? OR (created_at = ? AND id < ?))
                if (q.includes('CREATED_AT < ?')) {
                  const cursorCreatedAt = args[1] as string
                  const cursorId = args[3] as string
                  filtered = filtered.filter(s =>
                    s.created_at < cursorCreatedAt ||
                    (s.created_at === cursorCreatedAt && s.id < cursorId)
                  )
                }

                // ORDER BY created_at DESC, id DESC
                filtered.sort((a, b) => {
                  const cmp = b.created_at.localeCompare(a.created_at)
                  return cmp !== 0 ? cmp : b.id.localeCompare(a.id)
                })

                const limit = args[args.length - 1] as number
                return { results: filtered.slice(0, limit) as unknown as T[] }
              }

              // SELECT * FROM paragraphs WHERE session_id = ? [AND position > ?] ORDER BY position ASC LIMIT ?
              if (q.startsWith('SELECT * FROM PARAGRAPHS WHERE SESSION_ID = ?')) {
                const sessionId = args[0] as string
                let ps = getSessionParagraphs(sessionId)
                if (q.includes('POSITION > ?')) {
                  const cursor = args[1] as number
                  ps = ps.filter(p => p.position > cursor)
                }
                ps.sort((a, b) => a.position - b.position)
                const limit = args[args.length - 1] as number
                return { results: ps.slice(0, limit) as unknown as T[] }
              }

              return { results: [] }
            },

            async run(): Promise<{ meta: { changes: number } }> {
              // INSERT INTO sessions …
              if (q.startsWith('INSERT INTO SESSIONS')) {
                const [id, device_id, listen_lang, translate_lang] = args as string[]
                const session: Session = {
                  id,
                  device_id,
                  listen_lang,
                  translate_lang,
                  created_at: new Date().toISOString(),
                  preview: null,
                }
                sessions.set(id, session)
                return { meta: { changes: 1 } }
              }

              // INSERT INTO paragraphs … SELECT … COALESCE(MAX(position), -1) + 1 … FROM paragraphs WHERE session_id = ?
              // args: id, session_id, original, translation, session_id
              if (q.startsWith('INSERT INTO PARAGRAPHS') && q.includes('COALESCE')) {
                const [id, session_id, original, translation] = args as string[]
                const ps = getSessionParagraphs(session_id)
                const maxPos = ps.length > 0 ? Math.max(...ps.map(p => p.position)) : -1
                const position = maxPos + 1
                const para: Paragraph = { id, session_id, position, original, translation }
                paragraphs.set(id, para)
                return { meta: { changes: 1 } }
              }

              // UPDATE sessions SET preview = ? WHERE id = ?
              if (q.startsWith('UPDATE SESSIONS SET PREVIEW')) {
                const [preview, id] = args as string[]
                const s = sessions.get(id)
                if (s) sessions.set(id, { ...s, preview })
                return { meta: { changes: 1 } }
              }

              // DELETE FROM sessions WHERE id = ? AND device_id = ?
              if (q.startsWith('DELETE FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                if (s && s.device_id === deviceId) {
                  sessions.delete(id)
                  return { meta: { changes: 1 } }
                }
                return { meta: { changes: 0 } }
              }

              return { meta: { changes: 0 } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

describe('sessions (behavioral)', () => {
  let db: D1Database

  beforeEach(() => {
    db = createMockD1()
  })

  describe('createSession', () => {
    it('returns a session object with correct fields', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(session.device_id).toBe('device-1')
      expect(session.listen_lang).toBe('en')
      expect(session.translate_lang).toBe('fr')
      expect(session.preview).toBeNull()
      expect(typeof session.created_at).toBe('string')
    })

    it('creates distinct sessions for distinct calls', async () => {
      const s1 = await createSession('device-1', 'en', 'fr', db)
      const s2 = await createSession('device-1', 'en', 'fr', db)
      expect(s1.id).not.toBe(s2.id)
    })
  })

  describe('listSessions', () => {
    it('returns sessions for the correct device only', async () => {
      await createSession('device-A', 'en', 'fr', db)
      await createSession('device-A', 'en', 'fr', db)
      await createSession('device-B', 'en', 'fr', db)

      const result = await listSessions('device-A', null, 10, db)
      expect(result.sessions).toHaveLength(2)
      expect(result.sessions.every(s => s.device_id === 'device-A')).toBe(true)
    })

    it('returns empty array when no sessions exist for device', async () => {
      const result = await listSessions('no-such-device', null, 10, db)
      expect(result.sessions).toHaveLength(0)
      expect(result.cursor).toBeNull()
    })

    it('paginates and returns a cursor when there are more results than limit', async () => {
      for (let i = 0; i < 3; i++) {
        await createSession('device-page', 'en', 'fr', db)
      }
      const result = await listSessions('device-page', null, 2, db)
      expect(result.sessions).toHaveLength(2)
      expect(result.cursor).not.toBeNull()
    })
  })

  describe('appendParagraph', () => {
    it('increments position correctly for successive paragraphs', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      const p0 = await appendParagraph(session.id, 'device-1', 'Hello', 'Bonjour', db)
      const p1 = await appendParagraph(session.id, 'device-1', 'World', 'Monde', db)
      const p2 = await appendParagraph(session.id, 'device-1', 'Foo', 'Bar', db)
      expect(p0?.position).toBe(0)
      expect(p1?.position).toBe(1)
      expect(p2?.position).toBe(2)
    })

    it('sets preview on first paragraph', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      await appendParagraph(session.id, 'device-1', 'First paragraph text', 'Translated', db)
      const { sessions } = await listSessions('device-1', null, 10, db)
      expect(sessions[0].preview).toBe('First paragraph text')
    })

    it('does not update preview after first paragraph', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      await appendParagraph(session.id, 'device-1', 'First', 'Premier', db)
      await appendParagraph(session.id, 'device-1', 'Second', 'Deuxieme', db)
      const { sessions } = await listSessions('device-1', null, 10, db)
      expect(sessions[0].preview).toBe('First')
    })

    it('returns null when session does not belong to device', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      const result = await appendParagraph(session.id, 'wrong-device', 'Hello', 'Bonjour', db)
      expect(result).toBeNull()
    })

    it('truncates preview to 100 chars when original is longer', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      const longText = 'A'.repeat(150)
      await appendParagraph(session.id, 'device-1', longText, 'Trans', db)
      const { sessions } = await listSessions('device-1', null, 10, db)
      expect(sessions[0].preview).toBe('A'.repeat(100))
    })
  })

  describe('deleteSession', () => {
    it('returns true when deleting an existing session', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      const result = await deleteSession(session.id, 'device-1', db)
      expect(result).toBe(true)
    })

    it('returns false when session does not exist', async () => {
      const result = await deleteSession('non-existent-id', 'device-1', db)
      expect(result).toBe(false)
    })

    it('returns false when session belongs to a different device', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      const result = await deleteSession(session.id, 'device-2', db)
      expect(result).toBe(false)
    })

    it('session is no longer listed after deletion', async () => {
      const session = await createSession('device-1', 'en', 'fr', db)
      await deleteSession(session.id, 'device-1', db)
      const { sessions } = await listSessions('device-1', null, 10, db)
      expect(sessions).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Integration tests for /api/sessions/:id/finalize via worker.fetch
// ---------------------------------------------------------------------------

function createFullMockD1() {
  const devices: Map<string, { id: string; token_hash: string }> = new Map()
  const settingsMap: Map<string, { listen_lang: string; translate_lang: string; context: string; persona: string; translate_provider: string; translate_model: string }> = new Map()
  const sessions: Map<string, Session> = new Map()
  const paragraphs: Map<string, Paragraph> = new Map()

  function getSessionParagraphs(sessionId: string): Paragraph[] {
    return Array.from(paragraphs.values()).filter(p => p.session_id === sessionId)
  }

  return {
    prepare(query: string) {
      const q = query.trim().replace(/\s+/g, ' ').toUpperCase()
      return {
        bind(...args: unknown[]) {
          return {
            async first<T = unknown>(): Promise<T | null> {
              // Device lookup by token_hash
              if (q.includes('SELECT') && q.includes('DEVICES') && q.includes('TOKEN_HASH = ?')) {
                for (const device of devices.values()) {
                  if (device.token_hash === args[0]) return { id: device.id } as T
                }
                return null
              }
              // Device lookup by id
              if (q.includes('SELECT') && q.includes('DEVICES WHERE ID = ?')) {
                return (devices.get(args[0] as string) ?? null) as T | null
              }
              // Session by id + device_id
              if (q.startsWith('SELECT * FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                return (s && s.device_id === deviceId ? s : null) as T | null
              }
              // Session by id only
              if (q.startsWith('SELECT * FROM SESSIONS WHERE ID = ?')) {
                return (sessions.get(args[0] as string) ?? null) as T | null
              }
              // Session ownership check (SELECT ID FROM sessions WHERE id = ? AND device_id = ?)
              if (q.startsWith('SELECT ID FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                return (s && s.device_id === deviceId ? { id: s.id } : null) as T | null
              }
              // Finalize ownership query (SELECT id, listen_lang, translate_lang FROM sessions WHERE id = ? AND device_id = ?)
              if (q.startsWith('SELECT ID, LISTEN_LANG, TRANSLATE_LANG FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                return (s && s.device_id === deviceId ? { id: s.id, listen_lang: s.listen_lang, translate_lang: s.translate_lang } : null) as T | null
              }
              // Paragraph position
              if (q.startsWith('SELECT POSITION FROM PARAGRAPHS WHERE ID = ?')) {
                const p = paragraphs.get(args[0] as string)
                return (p ? { position: p.position } : null) as T | null
              }
              // Settings
              if (q.includes('SELECT') && q.includes('SETTINGS') && q.includes('DEVICE_ID = ?')) {
                const s = settingsMap.get(args[0] as string)
                return (s ?? null) as T | null
              }
              return null
            },

            async all<T = unknown>(): Promise<{ results: T[] }> {
              // Sessions for device
              if (q.startsWith('SELECT * FROM SESSIONS WHERE DEVICE_ID = ?')) {
                const deviceId = args[0] as string
                let filtered = Array.from(sessions.values()).filter(s => s.device_id === deviceId)
                if (q.includes('CREATED_AT < ?')) {
                  const cursorCreatedAt = args[1] as string
                  const cursorId = args[3] as string
                  filtered = filtered.filter(s =>
                    s.created_at < cursorCreatedAt ||
                    (s.created_at === cursorCreatedAt && s.id < cursorId)
                  )
                }
                filtered.sort((a, b) => {
                  const cmp = b.created_at.localeCompare(a.created_at)
                  return cmp !== 0 ? cmp : b.id.localeCompare(a.id)
                })
                const limit = args[args.length - 1] as number
                return { results: filtered.slice(0, limit) as unknown as T[] }
              }
              // Paragraphs for session
              if (q.startsWith('SELECT * FROM PARAGRAPHS WHERE SESSION_ID = ?')) {
                const sessionId = args[0] as string
                let ps = getSessionParagraphs(sessionId)
                if (q.includes('POSITION > ?')) {
                  const cursor = args[1] as number
                  ps = ps.filter(p => p.position > cursor)
                }
                ps.sort((a, b) => a.position - b.position)
                const limit = args[args.length - 1] as number
                return { results: ps.slice(0, limit) as unknown as T[] }
              }
              // Untranslated paragraphs for finalize
              if (q.includes('SELECT') && q.includes('PARAGRAPHS') && q.includes('SESSION_ID = ?') && q.includes('TRANSLATION')) {
                const sessionId = args[0] as string
                const ps = getSessionParagraphs(sessionId).filter(p => !p.translation)
                return { results: ps as unknown as T[] }
              }
              return { results: [] }
            },

            async run(): Promise<{ meta: { changes: number } }> {
              // Device insert
              if (q.startsWith('INSERT INTO DEVICES')) {
                devices.set(args[0] as string, { id: args[0] as string, token_hash: args[1] as string })
                return { meta: { changes: 1 } }
              }
              // Settings insert
              if (q.startsWith('INSERT INTO SETTINGS')) {
                settingsMap.set(args[0] as string, { listen_lang: 'en', translate_lang: 'el', context: '', persona: '', translate_provider: 'amazon', translate_model: 'gpt-4o-mini' })
                return { meta: { changes: 1 } }
              }
              // Session insert
              if (q.startsWith('INSERT INTO SESSIONS')) {
                const [id, device_id, listen_lang, translate_lang, mode] = args as string[]
                sessions.set(id, { id, device_id, listen_lang, translate_lang, created_at: new Date().toISOString(), preview: null, mode: mode ?? 'listen' })
                return { meta: { changes: 1 } }
              }
              // Paragraph insert
              if (q.startsWith('INSERT INTO PARAGRAPHS') && q.includes('COALESCE')) {
                const [id, session_id, original, translation] = args as string[]
                const ps = getSessionParagraphs(session_id)
                const maxPos = ps.length > 0 ? Math.max(...ps.map(p => p.position)) : -1
                paragraphs.set(id, { id, session_id, position: maxPos + 1, original, translation })
                return { meta: { changes: 1 } }
              }
              // Session preview update
              if (q.startsWith('UPDATE SESSIONS SET PREVIEW')) {
                const [preview, id] = args as string[]
                const s = sessions.get(id)
                if (s) sessions.set(id, { ...s, preview })
                return { meta: { changes: 1 } }
              }
              // Paragraph translation update
              if (q.startsWith('UPDATE PARAGRAPHS SET TRANSLATION')) {
                const [translation, id] = args as string[]
                const p = paragraphs.get(id)
                if (p) paragraphs.set(id, { ...p, translation })
                return { meta: { changes: p ? 1 : 0 } }
              }
              // Device log insert — silently succeed
              if (q.startsWith('INSERT INTO DEVICE_LOGS') || q.includes('DEVICE_LOGS')) {
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 0 } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

function createMockKV(): KVNamespace {
  const store: Map<string, string> = new Map()
  return {
    async get(key: string) { return store.get(key) ?? null },
    async put(key: string, value: string) { store.set(key, value) },
    async delete(key: string) { store.delete(key) },
    async list() { return { keys: [], list_complete: true, cursor: undefined } },
    async getWithMetadata(key: string) { return { value: store.get(key) ?? null, metadata: null } },
  } as unknown as KVNamespace
}

describe('finalize route (integration)', () => {
  let env: { DB: D1Database; KV: KVNamespace; ENCRYPTION_KEY: string; ELEVENLABS_API_BASE: string; AWS_TRANSLATE_ENDPOINT: string; ADMIN_PASSWORD: string }
  let ctx: ExecutionContext
  let token: string

  beforeEach(async () => {
    env = {
      DB: createFullMockD1(),
      KV: createMockKV(),
      ENCRYPTION_KEY: 'test-encryption-key-32-chars-long!',
      ELEVENLABS_API_BASE: 'https://api.elevenlabs.io',
      AWS_TRANSLATE_ENDPOINT: '',
      ADMIN_PASSWORD: 'admin',
    }
    ctx = {
      waitUntil(promise: Promise<unknown>) { /* fire and forget in tests */ },
      passThroughOnException() {},
    } as unknown as ExecutionContext

    // Register a device and grab the token
    const regRes = await worker.fetch(
      new Request('http://example.com/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'test-device' }),
      }),
      env, ctx
    )
    const regBody = await regRes.json<{ token: string }>()
    token = regBody.token
  })

  it('POST /api/sessions/:id/finalize returns 200 immediately', async () => {
    // Create a session first
    const createRes = await worker.fetch(
      new Request('http://example.com/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listen_lang: 'en', translate_lang: 'el', mode: 'stealth' }),
      }),
      env, ctx
    )
    const { id } = await createRes.json<{ id: string }>()

    const res = await worker.fetch(
      new Request(`http://example.com/api/sessions/${id}/finalize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env, ctx
    )
    expect(res.status).toBe(200)
  })

  it('POST /api/sessions/:id/finalize returns 404 for unknown session', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/api/sessions/nonexistent/finalize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env, ctx
    )
    expect(res.status).toBe(404)
  })
})
