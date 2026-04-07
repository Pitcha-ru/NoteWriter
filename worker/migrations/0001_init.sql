CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  device_id      TEXT NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  listen_lang    TEXT NOT NULL,
  translate_lang TEXT NOT NULL,
  preview        TEXT
);

CREATE TABLE paragraphs (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  original    TEXT NOT NULL,
  translation TEXT NOT NULL,
  UNIQUE(session_id, position)
);

CREATE TABLE settings (
  device_id       TEXT PRIMARY KEY,
  listen_lang     TEXT NOT NULL DEFAULT 'en',
  translate_lang  TEXT NOT NULL DEFAULT 'el'
);

CREATE INDEX idx_sessions_device_id ON sessions(device_id);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);
CREATE INDEX idx_paragraphs_session_id ON paragraphs(session_id);
