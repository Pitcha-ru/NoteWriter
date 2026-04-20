// worker/src/device-log.ts
// Lightweight server-side logger — writes one row per API event to D1.
// Failures are silently swallowed so they never break the main request.

const RETENTION_DAYS = 7

export interface LogEntry {
  event: string
  data?: Record<string, unknown>
  duration_ms?: number
  status?: number
}

export async function writeLog(deviceId: string, entry: LogEntry, db: D1Database): Promise<void> {
  const ts = new Date().toISOString()
  const dataStr = entry.data ? JSON.stringify(entry.data) : null
  try {
    await db
      .prepare('INSERT INTO device_logs (device_id, ts, event, data, duration_ms, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(deviceId, ts, entry.event, dataStr, entry.duration_ms ?? null, entry.status ?? null)
      .run()

    // Lazy cleanup — fire-and-forget, don't await
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
    db.prepare('DELETE FROM device_logs WHERE device_id = ? AND ts < ?')
      .bind(deviceId, cutoff)
      .run()
      .catch(() => {})
  } catch {
    // Silent — log failures must never break the caller
  }
}

export interface DeviceLogRow {
  ts: string
  event: string
  data: Record<string, unknown> | null
  duration_ms: number | null
  status: number | null
}

export async function getLogs(deviceId: string, limit: number, db: D1Database): Promise<DeviceLogRow[]> {
  const result = await db
    .prepare('SELECT ts, event, data, duration_ms, status FROM device_logs WHERE device_id = ? ORDER BY ts DESC LIMIT ?')
    .bind(deviceId, limit)
    .all<{ ts: string; event: string; data: string | null; duration_ms: number | null; status: number | null }>()

  return result.results.map(row => ({
    ts: row.ts,
    event: row.event,
    data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
    duration_ms: row.duration_ms,
    status: row.status,
  }))
}
