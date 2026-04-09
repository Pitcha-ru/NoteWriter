export interface Note {
  id: string
  device_id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

export async function listNotes(deviceId: string, db: D1Database): Promise<Note[]> {
  const result = await db.prepare(
    'SELECT * FROM notes WHERE device_id = ? ORDER BY updated_at DESC'
  ).bind(deviceId).all<Note>()
  return result.results
}

export async function getNote(noteId: string, deviceId: string, db: D1Database): Promise<Note | null> {
  return db.prepare('SELECT * FROM notes WHERE id = ? AND device_id = ?')
    .bind(noteId, deviceId).first<Note>()
}

export async function createNote(deviceId: string, title: string, content: string, db: D1Database): Promise<Note> {
  const id = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO notes (id, device_id, title, content) VALUES (?, ?, ?, ?)'
  ).bind(id, deviceId, title, content).run()
  const note = await db.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first<Note>()
  return note!
}

export async function updateNote(noteId: string, deviceId: string, title: string, content: string, db: D1Database): Promise<boolean> {
  const result = await db.prepare(
    'UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND device_id = ?'
  ).bind(title, content, noteId, deviceId).run()
  return result.meta.changes > 0
}

export async function deleteNote(noteId: string, deviceId: string, db: D1Database): Promise<boolean> {
  const result = await db.prepare('DELETE FROM notes WHERE id = ? AND device_id = ?')
    .bind(noteId, deviceId).run()
  return result.meta.changes > 0
}
