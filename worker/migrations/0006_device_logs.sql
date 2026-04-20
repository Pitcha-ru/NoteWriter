-- Device-side event log (written by Worker on each API call)
CREATE TABLE IF NOT EXISTS device_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT    NOT NULL,
  ts          TEXT    NOT NULL,  -- ISO-8601
  event       TEXT    NOT NULL,  -- e.g. 'stt_token', 'translate', 'session_append'
  data        TEXT,              -- JSON payload with event details
  duration_ms INTEGER,          -- wall-clock time of the operation
  status      INTEGER           -- HTTP status returned to the client
);

CREATE INDEX IF NOT EXISTS idx_device_logs_device_ts
  ON device_logs (device_id, ts DESC);
