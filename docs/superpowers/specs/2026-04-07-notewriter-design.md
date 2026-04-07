# NoteWriter — Real-Time Translation App for Even Realities G2

## Overview

NoteWriter is a plugin for Even Realities G2 smart glasses that listens to speech, transcribes it in real-time, translates to a selected language, and displays both original and translation on the glasses display. History of all sessions is stored on a server and accessible both from the glasses and the phone web UI.

**Supported languages (STT + translation):** English, Greek, French, German.
**Supported languages (Even Hub manifest):** English, German, French (Greek not in Even Hub's valid set; Greek support is at the STT/translation level only).

## Tech Stack

| Component | Technology |
|---|---|
| Glasses plugin | Vanilla TypeScript + Vite + @evenrealities/even_hub_sdk |
| STT (speech-to-text) | ElevenLabs Scribe v2 Realtime (WebSocket, ~150ms latency) |
| Translation | Amazon Translate via `aws4fetch` (~50-80ms latency) |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Key storage | Cloudflare KV (AES-256 encrypted) |
| CI/CD | GitHub Actions |

## Architecture

```
G2 Glasses (display 576x288, 4 mics, touchpad)
      │ BLE
Even Realities App (Phone)
  ┌─────────────────────────────────────┐
  │  NoteWriter Plugin (Vanilla TS)     │
  │                                     │
  │  Glasses UI        Phone Web UI     │
  │  - Main Menu       - API Keys       │
  │  - Listen mode     - History        │
  │  - History         - Settings       │
  │  - Settings                         │
  └──────┬─────────────────┬────────────┘
         │ WebSocket        │ HTTPS
         ▼                  ▼
  ElevenLabs           Cloudflare Workers
  Scribe v2 RT         ├── D1 (sessions, paragraphs, settings)
  (via temp token)     ├── KV (encrypted API keys)
                       └── → Amazon Translate (via aws4fetch)
```

## Authentication

Device-based token authentication:

1. On first launch, the plugin sends `POST /api/register` with the device ID from Even Hub SDK.
2. The Worker generates a cryptographically random secret token, stores `hash(token)` in D1, and returns the token.
3. The plugin stores the token locally via `bridge.setLocalStorage()`.
4. All subsequent API requests include the token in `Authorization: Bearer <token>` header.
5. The Worker validates the token by hashing it and comparing against the stored hash.

This prevents device ID spoofing — the token is a shared secret known only to the device and the server.

## Glasses UI

### Display constraints
- Resolution: 576 x 288 pixels per eye
- Text container limit: 1,000 chars (creation) / 2,000 chars (update)
- Max containers per page: 4 image + 8 other
- Exactly one container must have `isEventCapture: 1`

### SDK rendering APIs
- **Text display:** `TextContainerProperty` + `bridge.createStartUpPageContainer()` for initial render, `bridge.textContainerUpgrade()` for in-place updates
- **Menus/lists:** `ListContainerProperty` with native firmware-handled scroll highlighting (max 20 items, 64 chars each)
- **Audio:** `bridge.audioControl(true/false)` for microphone capture

### Input events
Events arrive via `event.textEvent.eventType` or `event.listEvent`:
- `CLICK_EVENT (0)` — select / confirm
- `SCROLL_TOP_EVENT (1)` — scroll/navigate up
- `SCROLL_BOTTOM_EVENT (2)` — scroll/navigate down
- `DOUBLE_CLICK_EVENT (3)` — go back

### Lifecycle events
- `FOREGROUND_ENTER_EVENT` — plugin becomes active (resume audio, refresh state)
- `FOREGROUND_EXIT_EVENT` — plugin goes to background (pause audio, save state)

### Screens

**Main Menu** (uses `ListContainerProperty`):
- Listen (grayed out if API keys not configured)
- History
- Settings

**Listen (active mode)** (uses `TextContainerProperty`):
- No scroll. Latest 2-3 sentence pairs visible.
- Committed sentences appear with translation below (~230ms total latency).
- Partial transcripts update in real-time via `bridge.textContainerUpgrade()`.
- New pairs push old ones off screen.
- Double Click stops listening and returns to menu.
- Text must stay within 2,000 char limit per container update.

Display layout:
```
Committed sentence (original)
Translation of that sentence
                              
Partial transcript updating...
```

**History — session list** (uses `ListContainerProperty`):
- Each entry: date, time, first words of session
- Native scroll via Up/Down
- Click to open session
- Double Click to return to main menu

**History — session detail** (uses `TextContainerProperty`):
- Paragraphs of original text alternating with translation paragraphs
- Up/Down to scroll between paragraphs
- Double Click to return to session list

**Settings** (uses `ListContainerProperty`):
- Listen language: cycle through EN/EL/FR/DE with Click
- Translate to: cycle through EN/EL/FR/DE with Click
- Up/Down to move between fields
- Double Click to return to main menu

## Phone Web UI

Single-page app with three tabs. The plugin runs in a single WebView — routing between glasses display and phone UI is handled by the SDK context (glasses renders via bridge API; phone UI renders in the WebView DOM). The phone UI is the standard HTML/CSS/JS rendered in the WebView.

### Keys tab
- ElevenLabs API Key (masked input)
- AWS Access Key ID (masked input)
- AWS Secret Access Key (masked input)
- AWS Region (dropdown)
- Save button

### History tab
- List of sessions (date, time, preview text)
- Tap to open full session text
- Full session: paragraphs of original alternating with translation, scrollable

### Settings tab
- Listen language (dropdown: English, Greek, French, German)
- Translate to (dropdown: English, Greek, French, German)
- Save button

### Settings sync
- Settings are stored server-side (`GET/PUT /api/settings`).
- On glasses startup and on `FOREGROUND_ENTER_EVENT`, the plugin fetches current settings from the server.
- On phone settings save, settings are pushed to server.
- No real-time push — glasses poll on activation. This is sufficient because settings change rarely.

## Listen Mode Data Flow

1. User selects Listen → `bridge.audioControl(true)` starts microphone capture.
2. Plugin requests a temporary ElevenLabs session token from Worker (`POST /api/stt-token`). Worker uses the user's stored ElevenLabs key to mint a short-lived token via ElevenLabs API, returns it to the client. The raw API key never reaches the client.
3. Plugin opens WebSocket to ElevenLabs Scribe v2 using the temporary token.
4. PCM 16kHz 16-bit mono audio streams to ElevenLabs.
5. ElevenLabs returns events:
   - `PARTIAL_TRANSCRIPT` — displayed on screen as-is, updating in real-time
   - `COMMITTED_TRANSCRIPT` — sentence complete, immediately sent to Worker for translation
6. Worker receives sentence → decrypts AWS credentials from KV → signs request with `aws4fetch` → calls Amazon Translate → returns translation (~80ms).
7. Plugin displays committed sentence + translation on glasses display via `bridge.textContainerUpgrade()`.
8. In background: sentences are grouped into paragraphs (on pause >=2sec) and saved to D1 via `PATCH /api/sessions/:id`.
9. Double Click → `bridge.audioControl(false)`, WebSocket closed, return to menu.

**Total latency from speech to translation on screen: ~230ms** (150ms STT + 80ms translation).

### WebSocket lifecycle
- On connection failure or drop: exponential backoff reconnect (1s, 2s, 4s, max 10s).
- On reconnect: resume audio streaming, no session restart needed.
- On prolonged silence (>30s): keep connection alive, no special handling.
- Commit strategy: automatic (ElevenLabs decides sentence boundaries via `COMMITTED_TRANSCRIPT` events).

## Backend API

All requests (except `/api/register`) include `Authorization: Bearer <token>` header.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/register` | Register device, returns auth token |
| POST | `/api/stt-token` | Mint temporary ElevenLabs session token |
| POST | `/api/translate` | Translate text via Amazon Translate |
| GET | `/api/sessions?cursor=&limit=20` | List user's sessions (paginated) |
| GET | `/api/sessions/:id?cursor=&limit=50` | Session paragraphs (paginated) |
| POST | `/api/sessions` | Create new session (Listen start) |
| PATCH | `/api/sessions/:id` | Append paragraph to current session |
| DELETE | `/api/sessions/:id` | Delete a session and its paragraphs |
| GET | `/api/keys` | Get masked keys (EL: ****xyz, AWS: ****abc) |
| PUT | `/api/keys` | Save/update API keys |
| DELETE | `/api/keys` | Remove all stored API keys |
| GET | `/api/settings` | Get user settings (languages) |
| PUT | `/api/settings` | Update user settings |

### Translation request validation
- Source and target language must differ. If same, return 400 error.
- Supported language pairs: any combination of en, el, fr, de.

## Database Schema (D1)

```sql
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,  -- device ID from SDK
  token_hash  TEXT NOT NULL,     -- SHA-256 hash of auth token
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
```

## KV Structure

```
keys:{device_id} → JSON {
  elevenlabs_key: "encrypted_value",
  aws_access_key_id: "encrypted_value",
  aws_secret_access_key: "encrypted_value",
  aws_region: "eu-west-1"
}
```

Keys encrypted with AES-256. Master key stored as Workers secret.
Worker caches decrypted keys in memory (global scope) per device ID with 5-minute TTL to avoid repeated KV reads + decryption on rapid sequential translations.

## Security

- AWS credentials never leave the Worker. Translation is proxied server-side via `aws4fetch`.
- ElevenLabs: Worker mints a short-lived temporary token via ElevenLabs API using the stored key. Only the temp token reaches the client. Raw API key never leaves the server.
- All keys encrypted at rest in KV with AES-256.
- Auth via Bearer token (issued at device registration, validated by hash comparison).
- Required IAM policy for AWS user: `translate:TranslateText` on `*` resource.

## Error Handling

- No internet → "No connection" on glasses display
- Invalid ElevenLabs key → "Invalid ElevenLabs key", return to menu
- Invalid AWS key → original text shown without translation, "Translation error" message
- Listen menu item grayed out until keys are configured
- WebSocket drop → automatic reconnect with exponential backoff
- Amazon Translate throttling (`ThrottlingException`) → retry with backoff, show last successful translation meanwhile
- Same source/target language selected → 400 error from API, prevented in UI by disabling matching option
- KV decryption failure → "Please re-enter API keys" message

## Project Structure

```
notewriter/
├── app.json                  # Even Hub manifest
├── package.json              # Plugin dependencies + scripts
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── src/
│   ├── main.ts               # Entry point, bridge init
│   ├── glasses/
│   │   ├── menu.ts           # Main menu (ListContainerProperty)
│   │   ├── listen.ts         # Listen mode (TextContainerProperty)
│   │   ├── history.ts        # History list + viewer
│   │   ├── settings.ts       # Language selection
│   │   └── renderer.ts       # Text rendering helpers for display
│   ├── phone/
│   │   ├── index.html        # Phone web UI
│   │   ├── keys.ts           # API keys form
│   │   ├── history.ts        # History viewer
│   │   └── settings.ts       # Language settings
│   ├── services/
│   │   ├── stt.ts            # ElevenLabs WebSocket client
│   │   ├── api.ts            # HTTP client to Worker
│   │   └── state.ts          # Shared state (langs, device ID, token)
│   └── types.ts
├── worker/
│   ├── package.json          # Worker dependencies (aws4fetch, etc.)
│   ├── tsconfig.json         # Worker TS config
│   ├── src/
│   │   ├── index.ts          # Worker entry, router
│   │   ├── translate.ts      # Amazon Translate via aws4fetch
│   │   ├── sessions.ts       # Sessions/paragraphs CRUD
│   │   ├── keys.ts           # Key encrypt/decrypt
│   │   ├── settings.ts       # Settings CRUD
│   │   └── auth.ts           # Token registration + validation
│   ├── migrations/
│   │   └── 0001_init.sql     # D1 schema
│   └── wrangler.toml         # Cloudflare config (D1, KV bindings)
├── .github/
│   └── workflows/
│       └── deploy.yml        # CI/CD
└── docs/
```

## Even Hub Manifest (app.json)

```json
{
  "package_id": "com.notewriter.translator",
  "edition": "202601",
  "name": "NoteWriter",
  "version": "1.0.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.7",
  "entrypoint": "index.html",
  "permissions": [
    {
      "name": "g2-microphone",
      "desc": "Captures speech for real-time transcription"
    },
    {
      "name": "network",
      "desc": "Connects to translation and STT services",
      "whitelist": [
        "https://api.elevenlabs.io",
        "https://*.workers.dev"
      ]
    }
  ],
  "supported_languages": ["en", "de", "fr"]
}
```

## CI/CD (GitHub Actions)

Trigger: push to `main`.

Prerequisites: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets.

Steps:
1. Install dependencies (`npm ci` in root and `worker/`)
2. Install Even Hub CLI (`npm install -g @evenrealities/evenhub-cli`)
3. Build plugin (`npm run build:plugin`)
4. Pack `.ehpk` (`evenhub pack app.json dist -o notewriter.ehpk`)
5. Deploy Worker (`cd worker && npx wrangler deploy`)
6. Apply D1 migrations (`npx wrangler d1 migrations apply`)
7. Upload `.ehpk` as release artifact

Pull requests: build + check only, no deploy.

Even Hub publication: manual upload of `.ehpk` from GitHub Release.

### Package.json scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build:plugin": "vite build",
    "build:worker": "cd worker && npm run build",
    "build": "npm run build:plugin && npm run build:worker"
  }
}
```
