import { describe, it, expect, beforeEach } from 'vitest'
import { createSession, listSessions, appendParagraph, deleteSession } from '../sessions'
import type { Session, Paragraph } from '../sessions'

function createMockD1() {
  const sessions: Map<string, Session> = new Map()
  const paragraphs: Map<string, Paragraph[]> = new Map() // keyed by session_id

  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T = unknown>(): Promise<T | null> {
              const q = query.trim().toUpperCase()

              if (q.startsWith('INSERT INTO SESSIONS')) {
                // handled in run()
                return null
              }
              if (q.startsWith('SELECT * FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                return (s && s.device_id === deviceId ? s : null) as T | null
              }
              if (q.startsWith('SELECT * FROM SESSIONS WHERE ID = ?')) {
                return (sessions.get(args[0] as string) ?? null) as T | null
              }
              if (q.startsWith('SELECT ID FROM SESSIONS WHERE ID = ? AND DEVICE_ID = ?')) {
                const [id, deviceId] = args as string[]
                const s = sessions.get(id)
                return (s && s.device_id === deviceId ? { id: s.id } : null) as T | null
              }
              if (q.startsWith('SELECT MAX(POSITION)')) {
                const sessionId = args[0] as string
                const ps = paragraphs.get(sessionId) ?? []
                const max_pos = ps.length > 0 ? Math.max(...ps.map(p => p.position)) : null
                return { max_pos } as T
              }
              return null
            },

            async all<T = unknown>(): Promise<{ results: T[] }> {
              const q = query.trim().toUpperCase()

              if (q.startsWith('SELECT * FROM SESSIONS WHERE DEVICE_ID = ?')) {
                const [deviceId, ...rest] = args as unknown[]
                let filtered = Array.from(sessions.values()).filter(s => s.device_id === deviceId)
                // cursor: AND created_at < ?
                if (query.includes('created_at < ?')) {
                  const cursor = rest[0] as string
                  filtered = filtered.filter(s => s.created_at < cursor)
                }
                // ORDER BY created_at DESC
                filtered.sort((a, b) => b.created_at.localeCompare(a.created_at))
                const limit = rest[rest.length - 1] as number
                return { results: filtered.slice(0, limit) as unknown as T[] }
              }

              if (q.startsWith('SELECT * FROM PARAGRAPHS WHERE SESSION_ID = ?')) {
                const [sessionId, ...rest] = args as unknown[]
                let ps = (paragraphs.get(sessionId as string) ?? []).slice()
                // cursor: AND position > ?
                if (query.includes('position > ?')) {
                  const cursor = rest[0] as number
                  ps = ps.filter(p => p.position > cursor)
                }
                ps.sort((a, b) => a.position - b.position)
                const limit = rest[rest.length - 1] as number
                return { results: ps.slice(0, limit) as unknown as T[] }
              }

              return { results: [] }
            },

            async run(): Promise<{ meta: { changes: number } }> {
              const q = query.trim().toUpperCase()

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

              if (q.startsWith('INSERT INTO PARAGRAPHS')) {
                const [id, session_id, position, original, translation] = args as [string, string, number, string, string]
                const para: Paragraph = { id, session_id, position, original, translation }
                const list = paragraphs.get(session_id) ?? []
                list.push(para)
                paragraphs.set(session_id, list)
                return { meta: { changes: 1 } }
              }

              if (q.startsWith('UPDATE SESSIONS SET PREVIEW')) {
                const [preview, id] = args as string[]
                const s = sessions.get(id)
                if (s) sessions.set(id, { ...s, preview })
                return { meta: { changes: 1 } }
              }

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

    it('paginates with cursor when there are more results than limit', async () => {
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
      // Re-fetch to confirm preview was set via listSessions
      const { sessions } = await listSessions('device-1', null, 10, db)
      expect(sessions[0].preview).toBe('First paragraph text')
    })

    it('does not change preview after first paragraph', async () => {
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

    it('truncates preview to 100 chars if original is longer', async () => {
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
