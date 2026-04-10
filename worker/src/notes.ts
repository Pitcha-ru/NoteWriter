export interface Note {
  id: string
  device_id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

export async function listNotes(deviceId: string, db: D1Database): Promise<any[]> {
  // Personal notes
  const personal = await db.prepare(
    'SELECT id, device_id, title, content, created_at, updated_at FROM notes WHERE device_id = ? ORDER BY updated_at DESC'
  ).bind(deviceId).all()

  // Group notes (for groups this device belongs to, excluding hidden)
  const groupNotes = await db.prepare(`
    SELECT gn.id, gn.title, gn.content, gn.created_at, g.name as group_name
    FROM group_notes gn
    JOIN groups g ON g.id = gn.group_id
    JOIN group_devices gd ON gd.group_id = gn.group_id
    WHERE gd.device_id = ?
    AND gn.id NOT IN (SELECT note_id FROM hidden_group_notes WHERE device_id = ?)
    ORDER BY gn.created_at DESC
  `).bind(deviceId, deviceId).all()

  // Merge: add a 'type' field to distinguish
  const personalWithType = personal.results.map((n: any) => ({ ...n, type: 'personal' }))
  const groupWithType = groupNotes.results.map((n: any) => ({
    ...n,
    device_id: deviceId,
    updated_at: n.created_at,
    type: 'group',
  }))

  // Merge and sort by date (newest first)
  const all = [...personalWithType, ...groupWithType]
  all.sort((a: any, b: any) => {
    const dateA = a.updated_at || a.created_at || ''
    const dateB = b.updated_at || b.created_at || ''
    return dateB.localeCompare(dateA)
  })
  return all
}

export async function getNote(noteId: string, deviceId: string, db: D1Database): Promise<Note | null> {
  // Try personal notes first
  const personal = await db.prepare('SELECT * FROM notes WHERE id = ? AND device_id = ?')
    .bind(noteId, deviceId).first<Note>()
  if (personal) return personal

  // Try group notes (verify device is in the group)
  const groupNote = await db.prepare(`
    SELECT gn.id, gn.title, gn.content, gn.created_at, gn.created_at as updated_at
    FROM group_notes gn
    JOIN group_devices gd ON gd.group_id = gn.group_id
    WHERE gn.id = ? AND gd.device_id = ?
  `).bind(noteId, deviceId).first<Note>()
  return groupNote ?? null
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
