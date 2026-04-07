import { generateToken, hashToken } from './crypto'

export async function handleRegister(
  deviceId: string,
  db: D1Database
): Promise<{ token?: string; error?: string }> {
  const existing = await db
    .prepare('SELECT id FROM devices WHERE id = ?')
    .bind(deviceId)
    .first()

  if (existing) {
    return { error: 'Device already registered' }
  }

  const token = generateToken()
  const tokenHash = await hashToken(token)

  await db
    .prepare('INSERT INTO devices (id, token_hash) VALUES (?, ?)')
    .bind(deviceId, tokenHash)
    .run()

  await db
    .prepare('INSERT INTO settings (device_id) VALUES (?)')
    .bind(deviceId)
    .run()

  return { token }
}

export async function authenticate(
  token: string,
  db: D1Database
): Promise<{ deviceId?: string; error?: string }> {
  const tokenHash = await hashToken(token)

  const device = await db
    .prepare('SELECT id FROM devices WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ id: string }>()

  if (!device) {
    return { error: 'Unauthorized' }
  }

  return { deviceId: device.id }
}
