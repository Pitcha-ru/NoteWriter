export interface Session {
  id: string
  device_id: string
  created_at: string
  listen_lang: string
  translate_lang: string
  preview: string | null
}

export interface Paragraph {
  id: string
  session_id: string
  position: number
  original: string
  translation: string
}

export async function createSession(deviceId: string, listenLang: string, translateLang: string, db: D1Database): Promise<Session> {
  const id = crypto.randomUUID()
  await db.prepare('INSERT INTO sessions (id, device_id, listen_lang, translate_lang) VALUES (?, ?, ?, ?)')
    .bind(id, deviceId, listenLang, translateLang).run()
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>()
  return session!
}

export async function listSessions(deviceId: string, cursor: string | null, limit: number, db: D1Database): Promise<{ sessions: Session[]; cursor: string | null }> {
  let query = 'SELECT * FROM sessions WHERE device_id = ?'
  const params: unknown[] = [deviceId]
  if (cursor) { query += ' AND created_at < ?'; params.push(cursor) }
  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit + 1)
  const result = await db.prepare(query).bind(...params).all<Session>()
  const sessions = result.results
  let nextCursor: string | null = null
  if (sessions.length > limit) { sessions.pop(); nextCursor = sessions[sessions.length - 1].created_at }
  return { sessions, cursor: nextCursor }
}

export async function getSession(sessionId: string, deviceId: string, cursor: number | null, limit: number, db: D1Database): Promise<{ session: Session; paragraphs: Paragraph[]; cursor: number | null } | null> {
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ? AND device_id = ?').bind(sessionId, deviceId).first<Session>()
  if (!session) return null
  let query = 'SELECT * FROM paragraphs WHERE session_id = ?'
  const params: unknown[] = [sessionId]
  if (cursor !== null) { query += ' AND position > ?'; params.push(cursor) }
  query += ' ORDER BY position ASC LIMIT ?'
  params.push(limit + 1)
  const result = await db.prepare(query).bind(...params).all<Paragraph>()
  const paragraphs = result.results
  let nextCursor: number | null = null
  if (paragraphs.length > limit) { paragraphs.pop(); nextCursor = paragraphs[paragraphs.length - 1].position }
  return { session, paragraphs, cursor: nextCursor }
}

export async function appendParagraph(sessionId: string, deviceId: string, original: string, translation: string, db: D1Database): Promise<Paragraph | null> {
  const session = await db.prepare('SELECT id FROM sessions WHERE id = ? AND device_id = ?').bind(sessionId, deviceId).first()
  if (!session) return null
  const last = await db.prepare('SELECT MAX(position) as max_pos FROM paragraphs WHERE session_id = ?').bind(sessionId).first<{ max_pos: number | null }>()
  const position = (last?.max_pos ?? -1) + 1
  const id = crypto.randomUUID()
  await db.prepare('INSERT INTO paragraphs (id, session_id, position, original, translation) VALUES (?, ?, ?, ?, ?)')
    .bind(id, sessionId, position, original, translation).run()
  if (position === 0) {
    await db.prepare('UPDATE sessions SET preview = ? WHERE id = ?').bind(original.slice(0, 100), sessionId).run()
  }
  return { id, session_id: sessionId, position, original, translation }
}

export async function deleteSession(sessionId: string, deviceId: string, db: D1Database): Promise<boolean> {
  const result = await db.prepare('DELETE FROM sessions WHERE id = ? AND device_id = ?').bind(sessionId, deviceId).run()
  return result.meta.changes > 0
}
