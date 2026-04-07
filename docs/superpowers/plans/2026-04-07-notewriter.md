# NoteWriter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time speech transcription and translation plugin for Even Realities G2 smart glasses with a Cloudflare Workers backend.

**Architecture:** Plugin (Vanilla TS + Vite) runs in Even Realities WebView, renders to glasses via SDK bridge and to phone via DOM. Backend is Cloudflare Workers with D1 (sessions, auth, settings) and KV (encrypted API keys). STT via ElevenLabs Scribe v2 WebSocket, translation via Amazon Translate proxied through Worker using aws4fetch.

**Tech Stack:** TypeScript, Vite, @evenrealities/even_hub_sdk, Cloudflare Workers, D1, KV, aws4fetch, ElevenLabs Scribe v2, Amazon Translate, Vitest + Miniflare (testing), GitHub Actions (CI/CD).

**Spec:** `docs/superpowers/specs/2026-04-07-notewriter-design.md`

---

## File Structure

### Plugin (root)

| File | Responsibility |
|---|---|
| `app.json` | Even Hub manifest |
| `package.json` | Plugin deps + scripts |
| `tsconfig.json` | TS config |
| `vite.config.ts` | Vite build config |
| `index.html` | Entry HTML |
| `src/main.ts` | Entry point: bridge init, routing between glasses/phone |
| `src/types.ts` | Shared types (Session, Paragraph, Settings, etc.) |
| `src/services/api.ts` | HTTP client to Cloudflare Worker (all endpoints) |
| `src/services/stt.ts` | ElevenLabs Scribe v2 WebSocket client |
| `src/services/state.ts` | App state: device ID, auth token, settings, current screen |
| `src/glasses/menu.ts` | Main menu (ListContainerProperty) |
| `src/glasses/listen.ts` | Listen mode: audio capture, STT, translate, display |
| `src/glasses/history.ts` | History list + session detail viewer |
| `src/glasses/settings.ts` | Language selection on glasses |
| `src/glasses/renderer.ts` | Helpers for TextContainerProperty rendering |
| `src/phone/index.html` | Phone UI HTML shell |
| `src/phone/keys.ts` | API keys form |
| `src/phone/history.ts` | History viewer (phone) |
| `src/phone/settings.ts` | Language settings (phone) |

### Worker (`worker/`)

| File | Responsibility |
|---|---|
| `worker/package.json` | Worker deps (aws4fetch, etc.) |
| `worker/tsconfig.json` | Worker TS config |
| `worker/wrangler.toml` | Cloudflare config (D1, KV bindings, secrets) |
| `worker/src/index.ts` | Entry point, router, CORS |
| `worker/src/auth.ts` | Device registration + Bearer token validation middleware |
| `worker/src/keys.ts` | API keys encrypt/decrypt, CRUD |
| `worker/src/settings.ts` | User settings CRUD |
| `worker/src/sessions.ts` | Sessions + paragraphs CRUD (paginated) |
| `worker/src/translate.ts` | Amazon Translate proxy via aws4fetch |
| `worker/src/stt-token.ts` | Mint ElevenLabs temporary session token |
| `worker/src/crypto.ts` | AES-256 encrypt/decrypt helpers |
| `worker/src/types.ts` | Worker-side types (Env bindings, request types) |
| `worker/migrations/0001_init.sql` | D1 schema |

### Tests

| File | Responsibility |
|---|---|
| `worker/src/__tests__/auth.test.ts` | Registration + token validation |
| `worker/src/__tests__/keys.test.ts` | Key encrypt/decrypt + CRUD |
| `worker/src/__tests__/settings.test.ts` | Settings CRUD |
| `worker/src/__tests__/sessions.test.ts` | Sessions + paragraphs CRUD |
| `worker/src/__tests__/translate.test.ts` | Translation proxy |
| `worker/src/__tests__/stt-token.test.ts` | ElevenLabs token minting |
| `src/__tests__/services/api.test.ts` | API client |
| `src/__tests__/services/state.test.ts` | State management |
| `src/__tests__/services/stt.test.ts` | STT WebSocket client |

### CI/CD

| File | Responsibility |
|---|---|
| `.github/workflows/deploy.yml` | Build + deploy on push to main |
| `.github/workflows/pr.yml` | Build + test on PR |
| `.gitignore` | Ignore patterns |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `app.json`, `.gitignore`
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.toml`
- Create: `src/types.ts`, `worker/src/types.ts`

- [ ] **Step 1: Initialize git repo**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
git init
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
dist/
.wrangler/
*.ehpk
.DS_Store
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "notewriter",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build:plugin": "vite build",
    "build:worker": "cd worker && npm run build",
    "build": "npm run build:plugin && npm run build:worker",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "@evenrealities/even_hub_sdk": "^0.0.7"
  }
}
```

- [ ] **Step 4: Create root `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022", "DOM"],
    "types": ["vitest/globals"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "worker"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

```typescript
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
```

- [ ] **Step 6: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NoteWriter</title>
</head>
<body>
  <div id="phone-ui" style="display:none;"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 7: Create `app.json`**

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

- [ ] **Step 8: Create `src/types.ts`**

```typescript
export type Language = 'en' | 'el' | 'fr' | 'de'

export interface Settings {
  listen_lang: Language
  translate_lang: Language
}

export interface Session {
  id: string
  device_id: string
  created_at: string
  listen_lang: Language
  translate_lang: Language
  preview: string | null
}

export interface Paragraph {
  id: string
  session_id: string
  position: number
  original: string
  translation: string
}

export interface SessionListResponse {
  sessions: Session[]
  cursor: string | null
}

export interface SessionDetailResponse {
  session: Session
  paragraphs: Paragraph[]
  cursor: string | null
}

export interface MaskedKeys {
  elevenlabs_key: string | null
  aws_access_key_id: string | null
  aws_region: string | null
}

export interface ApiKeys {
  elevenlabs_key: string
  aws_access_key_id: string
  aws_secret_access_key: string
  aws_region: string
}
```

- [ ] **Step 9: Create `src/main.ts` (stub)**

```typescript
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

async function init() {
  const bridge = await waitForEvenAppBridge()
  console.log('NoteWriter initialized', bridge)
}

init()
```

- [ ] **Step 10: Create `worker/package.json`**

```json
{
  "name": "notewriter-worker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run --outdir=dist",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  },
  "dependencies": {
    "aws4fetch": "^1.0.20"
  }
}
```

- [ ] **Step 11: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "vitest/globals"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 12: Create `worker/wrangler.toml`**

```toml
name = "notewriter-worker"
main = "src/index.ts"
compatibility_date = "2026-04-01"

[[d1_databases]]
binding = "DB"
database_name = "notewriter-db"
database_id = "placeholder-replace-after-creation"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "KV"
id = "placeholder-replace-after-creation"

[vars]
ELEVENLABS_API_BASE = "https://api.elevenlabs.io"
AWS_TRANSLATE_ENDPOINT = "https://translate.eu-west-1.amazonaws.com"
```

- [ ] **Step 13: Create `worker/src/types.ts`**

```typescript
export interface Env {
  DB: D1Database
  KV: KVNamespace
  ENCRYPTION_KEY: string  // Workers secret
  ELEVENLABS_API_BASE: string
  AWS_TRANSLATE_ENDPOINT: string
}

export interface AuthenticatedRequest {
  deviceId: string
}

export interface TranslateRequest {
  text: string
  source_lang: string
  target_lang: string
}

export interface KeysPayload {
  elevenlabs_key: string
  aws_access_key_id: string
  aws_secret_access_key: string
  aws_region: string
}

export interface SettingsPayload {
  listen_lang: string
  translate_lang: string
}
```

- [ ] **Step 14: Create `worker/src/index.ts` (stub router)**

```typescript
import { Env } from './types'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    const response = await handleRequest(request, env, path)
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  },
} satisfies ExportedHandler<Env>

async function handleRequest(request: Request, env: Env, path: string): Promise<Response> {
  // Routes will be added in subsequent tasks
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 15: Install dependencies**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npm install
cd worker && npm install && cd ..
```

- [ ] **Step 16: Verify builds**

Run: `npm run build:plugin`
Expected: `dist/` directory created with bundled `index.html` + JS.

Run: `cd worker && npx wrangler deploy --dry-run --outdir=dist`
Expected: Worker bundles without errors.

- [ ] **Step 17: Commit**

```bash
git add .
git commit -m "feat: scaffold project structure for plugin and worker"
```

---

## Task 2: D1 Schema + Migration

**Files:**
- Create: `worker/migrations/0001_init.sql`

- [ ] **Step 1: Create migration file**

```sql
-- worker/migrations/0001_init.sql

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
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd worker && npx wrangler d1 migrations list notewriter-db --local`
Expected: Shows `0001_init.sql` as pending.

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/0001_init.sql
git commit -m "feat: add D1 schema migration"
```

---

## Task 3: Worker Crypto Helpers

**Files:**
- Create: `worker/src/crypto.ts`
- Create: `worker/src/__tests__/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// worker/src/__tests__/crypto.test.ts
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, hashToken, generateToken } from '../crypto'

describe('crypto', () => {
  const masterKey = 'test-master-key-that-is-32-bytes!'

  describe('encrypt/decrypt', () => {
    it('round-trips plaintext', async () => {
      const plaintext = '{"key": "sk-abc123"}'
      const encrypted = await encrypt(plaintext, masterKey)
      expect(encrypted).not.toBe(plaintext)
      const decrypted = await decrypt(encrypted, masterKey)
      expect(decrypted).toBe(plaintext)
    })

    it('produces different ciphertext for same input (random IV)', async () => {
      const plaintext = 'same input'
      const a = await encrypt(plaintext, masterKey)
      const b = await encrypt(plaintext, masterKey)
      expect(a).not.toBe(b)
    })
  })

  describe('hashToken', () => {
    it('produces consistent hash for same input', async () => {
      const token = 'my-secret-token'
      const hash1 = await hashToken(token)
      const hash2 = await hashToken(token)
      expect(hash1).toBe(hash2)
    })

    it('produces different hash for different input', async () => {
      const hash1 = await hashToken('token-a')
      const hash2 = await hashToken('token-b')
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('generateToken', () => {
    it('produces 64-char hex string', () => {
      const token = generateToken()
      expect(token).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces unique tokens', () => {
      const a = generateToken()
      const b = generateToken()
      expect(a).not.toBe(b)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/crypto.test.ts`
Expected: FAIL — module `../crypto` not found.

- [ ] **Step 3: Implement crypto helpers**

```typescript
// worker/src/crypto.ts

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function deriveKey(masterKey: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterKey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode('notewriter-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encrypt(plaintext: string, masterKey: string): Promise<string> {
  const key = await deriveKey(masterKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  )
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...combined))
}

export async function decrypt(encrypted: string, masterKey: string): Promise<string> {
  const key = await deriveKey(masterKey)
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )
  return decoder.decode(plaintext)
}

export async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/__tests__/crypto.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/crypto.ts worker/src/__tests__/crypto.test.ts
git commit -m "feat: add AES-256-GCM encryption and token helpers"
```

---

## Task 4: Worker Auth (Registration + Middleware)

**Files:**
- Create: `worker/src/auth.ts`
- Create: `worker/src/__tests__/auth.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// worker/src/__tests__/auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleRegister, authenticate } from '../auth'
import { hashToken } from '../crypto'

// Miniflare provides D1 in test env via vitest-pool-workers
// For unit tests, we mock D1 with a simple in-memory store
function createMockD1() {
  const devices: Map<string, { id: string; token_hash: string }> = new Map()
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (query.includes('SELECT')) {
                return devices.get(args[0] as string) ?? null
              }
              return null
            },
            async run() {
              if (query.includes('INSERT')) {
                devices.set(args[0] as string, {
                  id: args[0] as string,
                  token_hash: args[1] as string,
                })
              }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

describe('auth', () => {
  let db: D1Database

  beforeEach(() => {
    db = createMockD1()
  })

  describe('handleRegister', () => {
    it('registers a new device and returns a token', async () => {
      const result = await handleRegister('device-123', db)
      expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns error if device already registered', async () => {
      await handleRegister('device-123', db)
      const result = await handleRegister('device-123', db)
      expect(result.error).toBe('Device already registered')
    })
  })

  describe('authenticate', () => {
    it('returns device ID for valid token', async () => {
      const { token } = await handleRegister('device-123', db)
      const result = await authenticate(token!, db)
      expect(result.deviceId).toBe('device-123')
    })

    it('returns error for invalid token', async () => {
      const result = await authenticate('invalid-token', db)
      expect(result.error).toBe('Unauthorized')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/auth.test.ts`
Expected: FAIL — module `../auth` not found.

- [ ] **Step 3: Implement auth**

```typescript
// worker/src/auth.ts
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

  // Create default settings for the device
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/__tests__/auth.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Wire register route into router**

```typescript
// worker/src/index.ts — replace handleRequest function
import { Env } from './types'
import { handleRegister, authenticate } from './auth'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    const response = await handleRequest(request, env, path)
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  },
} satisfies ExportedHandler<Env>

async function handleRequest(request: Request, env: Env, path: string): Promise<Response> {
  // Public route: registration
  if (path === '/api/register' && request.method === 'POST') {
    const body = await request.json<{ device_id: string }>()
    if (!body.device_id) {
      return json({ error: 'device_id required' }, 400)
    }
    const result = await handleRegister(body.device_id, env.DB)
    if (result.error) {
      return json({ error: result.error }, 409)
    }
    return json({ token: result.token }, 201)
  }

  // All other routes require auth
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const token = authHeader.slice(7)
  const auth = await authenticate(token, env.DB)
  if (auth.error) {
    return json({ error: auth.error }, 401)
  }
  const deviceId = auth.deviceId!

  // Authenticated routes will be added in subsequent tasks
  return json({ error: 'Not found' }, 404)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth.ts worker/src/__tests__/auth.test.ts worker/src/index.ts
git commit -m "feat: add device registration and token auth"
```

---

## Task 5: Worker Keys CRUD

**Files:**
- Create: `worker/src/keys.ts`
- Create: `worker/src/__tests__/keys.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// worker/src/__tests__/keys.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { saveKeys, getKeys, getMaskedKeys, deleteKeys } from '../keys'

function createMockKV() {
  const store = new Map<string, string>()
  return {
    async get(key: string) { return store.get(key) ?? null },
    async put(key: string, value: string) { store.set(key, value) },
    async delete(key: string) { store.delete(key) },
  } as unknown as KVNamespace
}

const masterKey = 'test-master-key-that-is-32-bytes!'

describe('keys', () => {
  let kv: KVNamespace

  beforeEach(() => {
    kv = createMockKV()
  })

  it('saves and retrieves keys', async () => {
    const payload = {
      elevenlabs_key: 'el-key-123',
      aws_access_key_id: 'AKIA123',
      aws_secret_access_key: 'secret456',
      aws_region: 'eu-west-1',
    }
    await saveKeys('device-1', payload, kv, masterKey)
    const result = await getKeys('device-1', kv, masterKey)
    expect(result).toEqual(payload)
  })

  it('returns null when no keys stored', async () => {
    const result = await getKeys('device-1', kv, masterKey)
    expect(result).toBeNull()
  })

  it('returns masked keys', async () => {
    await saveKeys('device-1', {
      elevenlabs_key: 'el-key-abcdef123',
      aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      aws_secret_access_key: 'secret',
      aws_region: 'eu-west-1',
    }, kv, masterKey)
    const masked = await getMaskedKeys('device-1', kv, masterKey)
    expect(masked!.elevenlabs_key).toBe('****123')
    expect(masked!.aws_access_key_id).toBe('****PLE')
    expect(masked!.aws_region).toBe('eu-west-1')
  })

  it('deletes keys', async () => {
    await saveKeys('device-1', {
      elevenlabs_key: 'key',
      aws_access_key_id: 'key',
      aws_secret_access_key: 'key',
      aws_region: 'eu-west-1',
    }, kv, masterKey)
    await deleteKeys('device-1', kv)
    const result = await getKeys('device-1', kv, masterKey)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/keys.test.ts`
Expected: FAIL — module `../keys` not found.

- [ ] **Step 3: Implement keys module**

```typescript
// worker/src/keys.ts
import { encrypt, decrypt } from './crypto'
import { KeysPayload, MaskedKeys } from './types'

const KV_PREFIX = 'keys:'

export async function saveKeys(
  deviceId: string,
  keys: KeysPayload,
  kv: KVNamespace,
  masterKey: string
): Promise<void> {
  const encrypted = await encrypt(JSON.stringify(keys), masterKey)
  await kv.put(`${KV_PREFIX}${deviceId}`, encrypted)
}

export async function getKeys(
  deviceId: string,
  kv: KVNamespace,
  masterKey: string
): Promise<KeysPayload | null> {
  const encrypted = await kv.get(`${KV_PREFIX}${deviceId}`)
  if (!encrypted) return null
  const decrypted = await decrypt(encrypted, masterKey)
  return JSON.parse(decrypted)
}

export async function getMaskedKeys(
  deviceId: string,
  kv: KVNamespace,
  masterKey: string
): Promise<MaskedKeys | null> {
  const keys = await getKeys(deviceId, kv, masterKey)
  if (!keys) return null
  return {
    elevenlabs_key: mask(keys.elevenlabs_key),
    aws_access_key_id: mask(keys.aws_access_key_id),
    aws_region: keys.aws_region,
  }
}

export async function deleteKeys(deviceId: string, kv: KVNamespace): Promise<void> {
  await kv.delete(`${KV_PREFIX}${deviceId}`)
}

function mask(value: string): string {
  if (value.length <= 3) return '****'
  return '****' + value.slice(-3)
}

// In-memory cache for decrypted keys (TTL: 5 minutes)
interface CacheEntry {
  keys: KeysPayload
  expiresAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getCachedKeys(
  deviceId: string,
  kv: KVNamespace,
  masterKey: string
): Promise<KeysPayload | null> {
  const cached = cache.get(deviceId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys
  }
  const keys = await getKeys(deviceId, kv, masterKey)
  if (keys) {
    cache.set(deviceId, { keys, expiresAt: Date.now() + CACHE_TTL_MS })
  }
  return keys
}
```

Add `MaskedKeys` to worker types:

```typescript
// Append to worker/src/types.ts
export interface MaskedKeys {
  elevenlabs_key: string | null
  aws_access_key_id: string | null
  aws_region: string | null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/__tests__/keys.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Wire keys routes into router**

Add to the authenticated section of `worker/src/index.ts`, after `const deviceId = auth.deviceId!`:

```typescript
  // Keys routes
  if (path === '/api/keys') {
    if (request.method === 'GET') {
      const masked = await getMaskedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
      return json(masked ?? { elevenlabs_key: null, aws_access_key_id: null, aws_region: null })
    }
    if (request.method === 'PUT') {
      const body = await request.json<KeysPayload>()
      if (!body.elevenlabs_key || !body.aws_access_key_id || !body.aws_secret_access_key || !body.aws_region) {
        return json({ error: 'All key fields required' }, 400)
      }
      await saveKeys(deviceId, body, env.KV, env.ENCRYPTION_KEY)
      return json({ ok: true })
    }
    if (request.method === 'DELETE') {
      await deleteKeys(deviceId, env.KV)
      return json({ ok: true })
    }
  }
```

Add import at top of `index.ts`:
```typescript
import { saveKeys, getMaskedKeys, deleteKeys } from './keys'
import { KeysPayload } from './types'
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/keys.ts worker/src/__tests__/keys.test.ts worker/src/types.ts worker/src/index.ts
git commit -m "feat: add encrypted API keys storage with CRUD"
```

---

## Task 6: Worker Settings CRUD

**Files:**
- Create: `worker/src/settings.ts`
- Create: `worker/src/__tests__/settings.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// worker/src/__tests__/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getSettings, updateSettings } from '../settings'

function createMockD1() {
  const settings: Map<string, { device_id: string; listen_lang: string; translate_lang: string }> = new Map()
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (query.includes('SELECT')) {
                return settings.get(args[0] as string) ?? null
              }
              return null
            },
            async run() {
              if (query.includes('UPDATE') || query.includes('INSERT')) {
                const deviceId = query.includes('UPDATE') ? args[2] as string : args[0] as string
                settings.set(deviceId, {
                  device_id: deviceId,
                  listen_lang: query.includes('UPDATE') ? args[0] as string : 'en',
                  translate_lang: query.includes('UPDATE') ? args[1] as string : 'el',
                })
              }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

describe('settings', () => {
  let db: D1Database

  beforeEach(() => {
    db = createMockD1()
  })

  it('returns default settings for new device', async () => {
    // Simulate registration creating default settings
    await db.prepare('INSERT INTO settings (device_id) VALUES (?)').bind('device-1').run()
    const settings = await getSettings('device-1', db)
    expect(settings).toEqual({ listen_lang: 'en', translate_lang: 'el' })
  })

  it('updates settings', async () => {
    await db.prepare('INSERT INTO settings (device_id) VALUES (?)').bind('device-1').run()
    await updateSettings('device-1', { listen_lang: 'fr', translate_lang: 'de' }, db)
    const settings = await getSettings('device-1', db)
    expect(settings!.listen_lang).toBe('fr')
    expect(settings!.translate_lang).toBe('de')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/settings.test.ts`
Expected: FAIL — module `../settings` not found.

- [ ] **Step 3: Implement settings module**

```typescript
// worker/src/settings.ts
import { SettingsPayload } from './types'

const VALID_LANGS = ['en', 'el', 'fr', 'de']

export async function getSettings(
  deviceId: string,
  db: D1Database
): Promise<SettingsPayload | null> {
  const row = await db
    .prepare('SELECT listen_lang, translate_lang FROM settings WHERE device_id = ?')
    .bind(deviceId)
    .first<{ listen_lang: string; translate_lang: string }>()
  return row ?? null
}

export async function updateSettings(
  deviceId: string,
  settings: SettingsPayload,
  db: D1Database
): Promise<{ error?: string }> {
  if (!VALID_LANGS.includes(settings.listen_lang) || !VALID_LANGS.includes(settings.translate_lang)) {
    return { error: 'Invalid language. Supported: en, el, fr, de' }
  }
  if (settings.listen_lang === settings.translate_lang) {
    return { error: 'Source and target language must differ' }
  }
  await db
    .prepare('UPDATE settings SET listen_lang = ?, translate_lang = ? WHERE device_id = ?')
    .bind(settings.listen_lang, settings.translate_lang, deviceId)
    .run()
  return {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/__tests__/settings.test.ts`
Expected: All 2 tests PASS.

- [ ] **Step 5: Wire settings routes into router**

Add to authenticated section of `worker/src/index.ts`:

```typescript
  // Settings routes
  if (path === '/api/settings') {
    if (request.method === 'GET') {
      const settings = await getSettings(deviceId, env.DB)
      return json(settings ?? { listen_lang: 'en', translate_lang: 'el' })
    }
    if (request.method === 'PUT') {
      const body = await request.json<SettingsPayload>()
      const result = await updateSettings(deviceId, body, env.DB)
      if (result.error) return json({ error: result.error }, 400)
      return json({ ok: true })
    }
  }
```

Add imports:
```typescript
import { getSettings, updateSettings } from './settings'
import { KeysPayload, SettingsPayload } from './types'
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/settings.ts worker/src/__tests__/settings.test.ts worker/src/index.ts
git commit -m "feat: add settings CRUD with language validation"
```

---

## Task 7: Worker Sessions CRUD

**Files:**
- Create: `worker/src/sessions.ts`
- Create: `worker/src/__tests__/sessions.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// worker/src/__tests__/sessions.test.ts
import { describe, it, expect } from 'vitest'
import { createSession, listSessions, getSession, appendParagraph, deleteSession } from '../sessions'

// For these tests we'll use Miniflare's D1.
// If Miniflare isn't configured, these serve as contract documentation.
// The actual integration test will run against local D1.

describe('sessions (contract)', () => {
  it('createSession returns a session object', () => {
    // Contract: createSession(deviceId, listenLang, translateLang, db) → Session
    expect(typeof createSession).toBe('function')
  })

  it('listSessions returns paginated results', () => {
    // Contract: listSessions(deviceId, cursor, limit, db) → { sessions, cursor }
    expect(typeof listSessions).toBe('function')
  })

  it('getSession returns session with paragraphs', () => {
    // Contract: getSession(sessionId, deviceId, cursor, limit, db) → { session, paragraphs, cursor }
    expect(typeof getSession).toBe('function')
  })

  it('appendParagraph adds a paragraph', () => {
    // Contract: appendParagraph(sessionId, deviceId, original, translation, db) → Paragraph
    expect(typeof appendParagraph).toBe('function')
  })

  it('deleteSession removes session and paragraphs', () => {
    // Contract: deleteSession(sessionId, deviceId, db) → { ok }
    expect(typeof deleteSession).toBe('function')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/sessions.test.ts`
Expected: FAIL — module `../sessions` not found.

- [ ] **Step 3: Implement sessions module**

```typescript
// worker/src/sessions.ts

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

export async function createSession(
  deviceId: string,
  listenLang: string,
  translateLang: string,
  db: D1Database
): Promise<Session> {
  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO sessions (id, device_id, listen_lang, translate_lang) VALUES (?, ?, ?, ?)')
    .bind(id, deviceId, listenLang, translateLang)
    .run()

  const session = await db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .bind(id)
    .first<Session>()

  return session!
}

export async function listSessions(
  deviceId: string,
  cursor: string | null,
  limit: number,
  db: D1Database
): Promise<{ sessions: Session[]; cursor: string | null }> {
  let query = 'SELECT * FROM sessions WHERE device_id = ?'
  const params: unknown[] = [deviceId]

  if (cursor) {
    query += ' AND created_at < ?'
    params.push(cursor)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit + 1) // fetch one extra to determine if there's a next page

  const stmt = db.prepare(query)
  const result = await stmt.bind(...params).all<Session>()
  const sessions = result.results

  let nextCursor: string | null = null
  if (sessions.length > limit) {
    sessions.pop()
    nextCursor = sessions[sessions.length - 1].created_at
  }

  return { sessions, cursor: nextCursor }
}

export async function getSession(
  sessionId: string,
  deviceId: string,
  cursor: number | null,
  limit: number,
  db: D1Database
): Promise<{ session: Session; paragraphs: Paragraph[]; cursor: number | null } | null> {
  const session = await db
    .prepare('SELECT * FROM sessions WHERE id = ? AND device_id = ?')
    .bind(sessionId, deviceId)
    .first<Session>()

  if (!session) return null

  let query = 'SELECT * FROM paragraphs WHERE session_id = ?'
  const params: unknown[] = [sessionId]

  if (cursor !== null) {
    query += ' AND position > ?'
    params.push(cursor)
  }

  query += ' ORDER BY position ASC LIMIT ?'
  params.push(limit + 1)

  const result = await db.prepare(query).bind(...params).all<Paragraph>()
  const paragraphs = result.results

  let nextCursor: number | null = null
  if (paragraphs.length > limit) {
    paragraphs.pop()
    nextCursor = paragraphs[paragraphs.length - 1].position
  }

  return { session, paragraphs, cursor: nextCursor }
}

export async function appendParagraph(
  sessionId: string,
  deviceId: string,
  original: string,
  translation: string,
  db: D1Database
): Promise<Paragraph | null> {
  // Verify session belongs to device
  const session = await db
    .prepare('SELECT id FROM sessions WHERE id = ? AND device_id = ?')
    .bind(sessionId, deviceId)
    .first()

  if (!session) return null

  // Get next position
  const last = await db
    .prepare('SELECT MAX(position) as max_pos FROM paragraphs WHERE session_id = ?')
    .bind(sessionId)
    .first<{ max_pos: number | null }>()

  const position = (last?.max_pos ?? -1) + 1
  const id = crypto.randomUUID()

  await db
    .prepare('INSERT INTO paragraphs (id, session_id, position, original, translation) VALUES (?, ?, ?, ?, ?)')
    .bind(id, sessionId, position, original, translation)
    .run()

  // Update preview on first paragraph
  if (position === 0) {
    const preview = original.slice(0, 100)
    await db
      .prepare('UPDATE sessions SET preview = ? WHERE id = ?')
      .bind(preview, sessionId)
      .run()
  }

  return { id, session_id: sessionId, position, original, translation }
}

export async function deleteSession(
  sessionId: string,
  deviceId: string,
  db: D1Database
): Promise<boolean> {
  // ON DELETE CASCADE handles paragraphs
  const result = await db
    .prepare('DELETE FROM sessions WHERE id = ? AND device_id = ?')
    .bind(sessionId, deviceId)
    .run()

  return result.meta.changes > 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/__tests__/sessions.test.ts`
Expected: All 5 contract tests PASS.

- [ ] **Step 5: Wire session routes into router**

Add to authenticated section of `worker/src/index.ts`:

```typescript
  // Session routes
  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)

  if (path === '/api/sessions') {
    if (request.method === 'GET') {
      const cursor = url.searchParams.get('cursor')
      const limit = parseInt(url.searchParams.get('limit') ?? '20')
      const result = await listSessions(deviceId, cursor, limit, env.DB)
      return json(result)
    }
    if (request.method === 'POST') {
      const body = await request.json<{ listen_lang: string; translate_lang: string }>()
      const session = await createSession(deviceId, body.listen_lang, body.translate_lang, env.DB)
      return json(session, 201)
    }
  }

  if (sessionMatch) {
    const sessionId = sessionMatch[1]
    if (request.method === 'GET') {
      const cursor = url.searchParams.get('cursor')
      const limit = parseInt(url.searchParams.get('limit') ?? '50')
      const result = await getSession(sessionId, deviceId, cursor ? parseInt(cursor) : null, limit, env.DB)
      if (!result) return json({ error: 'Session not found' }, 404)
      return json(result)
    }
    if (request.method === 'PATCH') {
      const body = await request.json<{ original: string; translation: string }>()
      const paragraph = await appendParagraph(sessionId, deviceId, body.original, body.translation, env.DB)
      if (!paragraph) return json({ error: 'Session not found' }, 404)
      return json(paragraph, 201)
    }
    if (request.method === 'DELETE') {
      const deleted = await deleteSession(sessionId, deviceId, env.DB)
      if (!deleted) return json({ error: 'Session not found' }, 404)
      return json({ ok: true })
    }
  }
```

Add imports:
```typescript
import { createSession, listSessions, getSession, appendParagraph, deleteSession } from './sessions'
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/sessions.ts worker/src/__tests__/sessions.test.ts worker/src/index.ts
git commit -m "feat: add sessions and paragraphs CRUD with pagination"
```

---

## Task 8: Worker Translation Proxy

**Files:**
- Create: `worker/src/translate.ts`
- Create: `worker/src/__tests__/translate.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// worker/src/__tests__/translate.test.ts
import { describe, it, expect } from 'vitest'
import { buildTranslateRequest, parseTranslateResponse, LANG_CODES } from '../translate'

describe('translate', () => {
  describe('LANG_CODES', () => {
    it('maps all supported languages', () => {
      expect(LANG_CODES.en).toBe('en')
      expect(LANG_CODES.el).toBe('el')
      expect(LANG_CODES.fr).toBe('fr')
      expect(LANG_CODES.de).toBe('de')
    })
  })

  describe('buildTranslateRequest', () => {
    it('builds correct request body', () => {
      const body = buildTranslateRequest('Hello world', 'en', 'el')
      expect(body).toEqual({
        SourceLanguageCode: 'en',
        TargetLanguageCode: 'el',
        Text: 'Hello world',
      })
    })

    it('rejects same source and target', () => {
      expect(() => buildTranslateRequest('Hello', 'en', 'en')).toThrow(
        'Source and target language must differ'
      )
    })
  })

  describe('parseTranslateResponse', () => {
    it('extracts translated text', () => {
      const response = { TranslatedText: 'Γεια σου κόσμε' }
      expect(parseTranslateResponse(response)).toBe('Γεια σου κόσμε')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/__tests__/translate.test.ts`
Expected: FAIL — module `../translate` not found.

- [ ] **Step 3: Implement translate module**

```typescript
// worker/src/translate.ts
import { AwsClient } from 'aws4fetch'

export const LANG_CODES: Record<string, string> = {
  en: 'en',
  el: 'el',
  fr: 'fr',
  de: 'de',
}

export function buildTranslateRequest(
  text: string,
  sourceLang: string,
  targetLang: string
): { SourceLanguageCode: string; TargetLanguageCode: string; Text: string } {
  if (sourceLang === targetLang) {
    throw new Error('Source and target language must differ')
  }
  return {
    SourceLanguageCode: LANG_CODES[sourceLang] ?? sourceLang,
    TargetLanguageCode: LANG_CODES[targetLang] ?? targetLang,
    Text: text,
  }
}

export function parseTranslateResponse(response: { TranslatedText: string }): string {
  return response.TranslatedText
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  awsRegion: string
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey,
    region: awsRegion,
    service: 'translate',
  })

  const body = buildTranslateRequest(text, sourceLang, targetLang)

  const response = await client.fetch(
    `https://translate.${awsRegion}.amazonaws.com/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSShineFrontendService_20170701.TranslateText',
      },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Amazon Translate error (${response.status}): ${errorBody}`)
  }

  const result = await response.json<{ TranslatedText: string }>()
  return parseTranslateResponse(result)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/__tests__/translate.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Wire translate route into router**

Add to authenticated section of `worker/src/index.ts`:

```typescript
  // Translate route
  if (path === '/api/translate' && request.method === 'POST') {
    const body = await request.json<TranslateRequest>()
    if (!body.text || !body.source_lang || !body.target_lang) {
      return json({ error: 'text, source_lang, and target_lang required' }, 400)
    }
    const keys = await getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
    if (!keys) {
      return json({ error: 'API keys not configured' }, 400)
    }
    try {
      const translated = await translateText(
        body.text,
        body.source_lang,
        body.target_lang,
        keys.aws_access_key_id,
        keys.aws_secret_access_key,
        keys.aws_region
      )
      return json({ translated_text: translated })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Translation failed'
      return json({ error: message }, 502)
    }
  }
```

Add imports:
```typescript
import { translateText } from './translate'
import { getCachedKeys, saveKeys, getMaskedKeys, deleteKeys } from './keys'
import { TranslateRequest, KeysPayload, SettingsPayload } from './types'
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/translate.ts worker/src/__tests__/translate.test.ts worker/src/index.ts
git commit -m "feat: add Amazon Translate proxy via aws4fetch"
```

---

## Task 9: Worker STT Token Minting

**Files:**
- Create: `worker/src/stt-token.ts`
- Create: `worker/src/__tests__/stt-token.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// worker/src/__tests__/stt-token.test.ts
import { describe, it, expect } from 'vitest'
import { buildTokenRequest } from '../stt-token'

describe('stt-token', () => {
  it('builds correct ElevenLabs token request', () => {
    const { url, options } = buildTokenRequest('el-key-123', 'https://api.elevenlabs.io')
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text/get-websocket-token')
    expect(options.method).toBe('GET')
    expect(options.headers['xi-api-key']).toBe('el-key-123')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/__tests__/stt-token.test.ts`
Expected: FAIL — module `../stt-token` not found.

- [ ] **Step 3: Implement stt-token module**

```typescript
// worker/src/stt-token.ts

export function buildTokenRequest(
  apiKey: string,
  apiBase: string
): { url: string; options: { method: string; headers: Record<string, string> } } {
  return {
    url: `${apiBase}/v1/speech-to-text/get-websocket-token`,
    options: {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
      },
    },
  }
}

export async function mintSttToken(
  apiKey: string,
  apiBase: string
): Promise<{ token: string } | { error: string }> {
  const { url, options } = buildTokenRequest(apiKey, apiBase)

  const response = await fetch(url, options)

  if (!response.ok) {
    const body = await response.text()
    return { error: `ElevenLabs token error (${response.status}): ${body}` }
  }

  const data = await response.json<{ token: string }>()
  return { token: data.token }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/__tests__/stt-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire stt-token route into router**

Add to authenticated section of `worker/src/index.ts`:

```typescript
  // STT token route
  if (path === '/api/stt-token' && request.method === 'POST') {
    const keys = await getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
    if (!keys?.elevenlabs_key) {
      return json({ error: 'ElevenLabs key not configured' }, 400)
    }
    const result = await mintSttToken(keys.elevenlabs_key, env.ELEVENLABS_API_BASE)
    if ('error' in result) {
      return json({ error: result.error }, 502)
    }
    return json({ token: result.token })
  }
```

Add import:
```typescript
import { mintSttToken } from './stt-token'
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/stt-token.ts worker/src/__tests__/stt-token.test.ts worker/src/index.ts
git commit -m "feat: add ElevenLabs temporary token minting"
```

---

## Task 10: Plugin State Management

**Files:**
- Create: `src/services/state.ts`
- Create: `src/__tests__/services/state.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/services/state.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { AppState } from '../../services/state'

describe('AppState', () => {
  let state: AppState

  beforeEach(() => {
    state = new AppState()
  })

  it('starts with default settings', () => {
    expect(state.settings).toEqual({ listen_lang: 'en', translate_lang: 'el' })
  })

  it('updates settings', () => {
    state.updateSettings({ listen_lang: 'fr', translate_lang: 'de' })
    expect(state.settings.listen_lang).toBe('fr')
  })

  it('tracks current screen', () => {
    expect(state.currentScreen).toBe('menu')
    state.navigateTo('listen')
    expect(state.currentScreen).toBe('listen')
  })

  it('tracks keys configured status', () => {
    expect(state.keysConfigured).toBe(false)
    state.setKeysConfigured(true)
    expect(state.keysConfigured).toBe(true)
  })

  it('stores auth token', () => {
    expect(state.authToken).toBeNull()
    state.setAuthToken('abc123')
    expect(state.authToken).toBe('abc123')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/services/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement state**

```typescript
// src/services/state.ts
import type { Settings, Language } from '../types'

export type Screen = 'menu' | 'listen' | 'history_list' | 'history_detail' | 'settings'

export class AppState {
  settings: Settings = { listen_lang: 'en', translate_lang: 'el' }
  currentScreen: Screen = 'menu'
  keysConfigured = false
  authToken: string | null = null
  deviceId: string | null = null
  currentSessionId: string | null = null

  updateSettings(settings: Partial<Settings>): void {
    this.settings = { ...this.settings, ...settings }
  }

  navigateTo(screen: Screen): void {
    this.currentScreen = screen
  }

  setKeysConfigured(configured: boolean): void {
    this.keysConfigured = configured
  }

  setAuthToken(token: string): void {
    this.authToken = token
  }

  setDeviceId(id: string): void {
    this.deviceId = id
  }
}

export const appState = new AppState()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/services/state.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/state.ts src/__tests__/services/state.test.ts
git commit -m "feat: add app state management"
```

---

## Task 11: Plugin API Client

**Files:**
- Create: `src/services/api.ts`
- Create: `src/__tests__/services/api.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/services/api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiClient } from '../../services/api'

describe('ApiClient', () => {
  let client: ApiClient

  beforeEach(() => {
    client = new ApiClient('https://worker.example.com')
    global.fetch = vi.fn()
  })

  it('register sends device_id and returns token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'abc123' }), { status: 201 })
    )
    const result = await client.register('device-1')
    expect(result).toEqual({ token: 'abc123' })
    expect(fetch).toHaveBeenCalledWith(
      'https://worker.example.com/api/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ device_id: 'device-1' }),
      })
    )
  })

  it('translate sends text and returns translation', async () => {
    client.setToken('token123')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ translated_text: 'Bonjour' }))
    )
    const result = await client.translate('Hello', 'en', 'fr')
    expect(result).toBe('Bonjour')
  })

  it('includes auth header on authenticated requests', async () => {
    client.setToken('mytoken')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ listen_lang: 'en', translate_lang: 'el' }))
    )
    await client.getSettings()
    expect(fetch).toHaveBeenCalledWith(
      'https://worker.example.com/api/settings',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mytoken',
        }),
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/services/api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement API client**

```typescript
// src/services/api.ts
import type { Settings, Session, Paragraph, SessionListResponse, SessionDetailResponse, MaskedKeys, ApiKeys } from '../types'

export class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  setToken(token: string): void {
    this.token = token
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(), ...options.headers as Record<string, string> },
    })
    if (!response.ok) {
      const body = await response.json<{ error: string }>().catch(() => ({ error: 'Request failed' }))
      throw new Error(body.error)
    }
    return response.json<T>()
  }

  // Auth
  async register(deviceId: string): Promise<{ token: string }> {
    return this.request('/api/register', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    })
  }

  // STT Token
  async getSttToken(): Promise<{ token: string }> {
    return this.request('/api/stt-token', { method: 'POST' })
  }

  // Translate
  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const result = await this.request<{ translated_text: string }>('/api/translate', {
      method: 'POST',
      body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
    })
    return result.translated_text
  }

  // Sessions
  async listSessions(cursor?: string, limit = 20): Promise<SessionListResponse> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return this.request(`/api/sessions?${params}`)
  }

  async getSession(id: string, cursor?: number, limit = 50): Promise<SessionDetailResponse> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor !== undefined) params.set('cursor', String(cursor))
    return this.request(`/api/sessions/${id}?${params}`)
  }

  async createSession(listenLang: string, translateLang: string): Promise<Session> {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ listen_lang: listenLang, translate_lang: translateLang }),
    })
  }

  async appendParagraph(sessionId: string, original: string, translation: string): Promise<Paragraph> {
    return this.request(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ original, translation }),
    })
  }

  async deleteSession(id: string): Promise<void> {
    await this.request(`/api/sessions/${id}`, { method: 'DELETE' })
  }

  // Keys
  async getKeys(): Promise<MaskedKeys> {
    return this.request('/api/keys')
  }

  async saveKeys(keys: ApiKeys): Promise<void> {
    await this.request('/api/keys', { method: 'PUT', body: JSON.stringify(keys) })
  }

  async deleteKeys(): Promise<void> {
    await this.request('/api/keys', { method: 'DELETE' })
  }

  // Settings
  async getSettings(): Promise<Settings> {
    return this.request('/api/settings')
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.request('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/services/api.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/api.ts src/__tests__/services/api.test.ts
git commit -m "feat: add API client for all Worker endpoints"
```

---

## Task 12: Plugin STT WebSocket Client

**Files:**
- Create: `src/services/stt.ts`
- Create: `src/__tests__/services/stt.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/services/stt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SttClient } from '../../services/stt'

describe('SttClient', () => {
  it('constructs with token and config', () => {
    const client = new SttClient('test-token', { language: 'en' })
    expect(client).toBeDefined()
  })

  it('emits partial transcripts via callback', () => {
    const client = new SttClient('test-token', { language: 'en' })
    const onPartial = vi.fn()
    const onCommitted = vi.fn()
    client.onPartialTranscript(onPartial)
    client.onCommittedTranscript(onCommitted)

    // Simulate receiving a partial transcript message
    client._handleMessage(JSON.stringify({
      type: 'PARTIAL_TRANSCRIPT',
      text: 'Hello wor',
    }))

    expect(onPartial).toHaveBeenCalledWith('Hello wor')
    expect(onCommitted).not.toHaveBeenCalled()
  })

  it('emits committed transcripts via callback', () => {
    const client = new SttClient('test-token', { language: 'en' })
    const onCommitted = vi.fn()
    client.onCommittedTranscript(onCommitted)

    client._handleMessage(JSON.stringify({
      type: 'COMMITTED_TRANSCRIPT',
      text: 'Hello world.',
    }))

    expect(onCommitted).toHaveBeenCalledWith('Hello world.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/services/stt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement STT client**

```typescript
// src/services/stt.ts

export interface SttConfig {
  language: string
}

type TranscriptCallback = (text: string) => void
type ErrorCallback = (error: Error) => void

export class SttClient {
  private token: string
  private config: SttConfig
  private ws: WebSocket | null = null
  private partialCallbacks: TranscriptCallback[] = []
  private committedCallbacks: TranscriptCallback[] = []
  private errorCallbacks: ErrorCallback[] = []
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private shouldReconnect = false

  constructor(token: string, config: SttConfig) {
    this.token = token
    this.config = config
  }

  onPartialTranscript(cb: TranscriptCallback): void {
    this.partialCallbacks.push(cb)
  }

  onCommittedTranscript(cb: TranscriptCallback): void {
    this.committedCallbacks.push(cb)
  }

  onError(cb: ErrorCallback): void {
    this.errorCallbacks.push(cb)
  }

  connect(): void {
    this.shouldReconnect = true
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/stream?token=${this.token}&language_code=${this.config.language}&encoding=pcm_s16le&sample_rate=16000`

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
    }

    this.ws.onmessage = (event) => {
      this._handleMessage(event.data as string)
    }

    this.ws.onerror = () => {
      this.errorCallbacks.forEach(cb => cb(new Error('WebSocket error')))
    }

    this.ws.onclose = () => {
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
        this.reconnectAttempts++
        setTimeout(() => this.connect(), delay)
      }
    }
  }

  sendAudio(pcmData: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcmData)
    }
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.ws?.close()
    this.ws = null
  }

  // Exposed for testing — do not call directly in production
  _handleMessage(data: string): void {
    try {
      const message = JSON.parse(data)
      if (message.type === 'PARTIAL_TRANSCRIPT' && message.text) {
        this.partialCallbacks.forEach(cb => cb(message.text))
      } else if (message.type === 'COMMITTED_TRANSCRIPT' && message.text) {
        this.committedCallbacks.forEach(cb => cb(message.text))
      }
    } catch {
      // Ignore unparseable messages
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/services/stt.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/stt.ts src/__tests__/services/stt.test.ts
git commit -m "feat: add ElevenLabs Scribe v2 WebSocket client"
```

---

## Task 13: Plugin Glasses Renderer

**Files:**
- Create: `src/glasses/renderer.ts`

- [ ] **Step 1: Implement renderer helpers**

This module wraps the Even Hub SDK display APIs into simpler functions. No unit tests — these are thin wrappers over SDK calls that can only be tested on hardware/simulator.

```typescript
// src/glasses/renderer.ts
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export interface TextDisplayConfig {
  text: string
  xPosition?: number
  yPosition?: number
  width?: number
  height?: number
  isEventCapture?: boolean
}

export function createTextPage(bridge: EvenAppBridge, configs: TextDisplayConfig[]): void {
  const containers = configs.map((c, i) => ({
    type: 'text' as const,
    properties: {
      xPosition: c.xPosition ?? 0,
      yPosition: c.yPosition ?? 0,
      width: c.width ?? 576,
      height: c.height ?? 288,
      text: c.text,
      isEventCapture: c.isEventCapture ? 1 : 0,
    },
    id: i,
  }))
  bridge.createStartUpPageContainer(containers)
}

export function updateText(bridge: EvenAppBridge, containerId: number, text: string): void {
  // Enforce 2000 char limit on updates
  const truncated = text.length > 2000 ? text.slice(-2000) : text
  bridge.textContainerUpgrade(containerId, { text: truncated })
}

export interface ListItem {
  text: string
}

export function createListPage(bridge: EvenAppBridge, items: ListItem[], eventCaptureId = 0): void {
  const container = {
    type: 'list' as const,
    properties: {
      items: items.map(item => ({
        text: item.text.slice(0, 64), // 64 char limit per item
      })),
      isEventCapture: 1,
    },
    id: eventCaptureId,
  }
  bridge.createStartUpPageContainer([container])
}

export function formatListenDisplay(
  committedPairs: Array<{ original: string; translation: string }>,
  partialText: string
): string {
  // Show last 2 committed pairs + current partial
  const recent = committedPairs.slice(-2)
  const lines: string[] = []

  for (const pair of recent) {
    lines.push(pair.original)
    lines.push(pair.translation)
    lines.push('')
  }

  if (partialText) {
    lines.push(partialText)
  }

  return lines.join('\n')
}

export function formatHistoryDetail(
  paragraphs: Array<{ original: string; translation: string }>,
  currentIndex: number
): string {
  // Show one paragraph pair at a time
  const p = paragraphs[currentIndex]
  if (!p) return ''
  return `${p.original}\n\n${p.translation}`
}
```

- [ ] **Step 2: Commit**

```bash
git add src/glasses/renderer.ts
git commit -m "feat: add glasses display renderer helpers"
```

---

## Task 14: Plugin Glasses Main Menu

**Files:**
- Create: `src/glasses/menu.ts`

- [ ] **Step 1: Implement main menu**

```typescript
// src/glasses/menu.ts
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { createListPage } from './renderer'
import { appState } from '../services/state'

const MENU_ITEMS = ['Listen', 'History', 'Settings']

export function showMenu(bridge: EvenAppBridge): void {
  appState.navigateTo('menu')

  const items = MENU_ITEMS.map(text => {
    if (text === 'Listen' && !appState.keysConfigured) {
      return { text: `${text} (setup keys first)` }
    }
    return { text }
  })

  createListPage(bridge, items)
}

export function handleMenuEvent(
  bridge: EvenAppBridge,
  eventType: number,
  selectedIndex: number,
  callbacks: {
    onListen: () => void
    onHistory: () => void
    onSettings: () => void
  }
): void {
  // CLICK_EVENT = 0
  if (eventType !== 0) return

  switch (selectedIndex) {
    case 0: // Listen
      if (!appState.keysConfigured) return // ignore if keys not set
      callbacks.onListen()
      break
    case 1: // History
      callbacks.onHistory()
      break
    case 2: // Settings
      callbacks.onSettings()
      break
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/glasses/menu.ts
git commit -m "feat: add glasses main menu"
```

---

## Task 15: Plugin Glasses Settings

**Files:**
- Create: `src/glasses/settings.ts`

- [ ] **Step 1: Implement settings screen**

```typescript
// src/glasses/settings.ts
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { createListPage } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Language } from '../types'

const LANGUAGES: Language[] = ['en', 'el', 'fr', 'de']
const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  el: 'Greek',
  fr: 'French',
  de: 'German',
}

export function showSettings(bridge: EvenAppBridge): void {
  appState.navigateTo('settings')
  renderSettings(bridge)
}

function renderSettings(bridge: EvenAppBridge): void {
  const items = [
    { text: `Listen: ${LANGUAGE_LABELS[appState.settings.listen_lang]}` },
    { text: `Translate: ${LANGUAGE_LABELS[appState.settings.translate_lang]}` },
  ]
  createListPage(bridge, items)
}

export function handleSettingsEvent(
  bridge: EvenAppBridge,
  eventType: number,
  selectedIndex: number,
  api: ApiClient,
  onBack: () => void
): void {
  // DOUBLE_CLICK_EVENT = 3 → back
  if (eventType === 3) {
    // Save settings to server before going back
    api.saveSettings(appState.settings).catch(() => {})
    onBack()
    return
  }

  // CLICK_EVENT = 0 → cycle language
  if (eventType === 0) {
    if (selectedIndex === 0) {
      const current = appState.settings.listen_lang
      const next = nextLanguage(current, appState.settings.translate_lang)
      appState.updateSettings({ listen_lang: next })
    } else if (selectedIndex === 1) {
      const current = appState.settings.translate_lang
      const next = nextLanguage(current, appState.settings.listen_lang)
      appState.updateSettings({ translate_lang: next })
    }
    renderSettings(bridge)
  }
}

function nextLanguage(current: Language, exclude: Language): Language {
  const currentIdx = LANGUAGES.indexOf(current)
  for (let i = 1; i < LANGUAGES.length; i++) {
    const candidate = LANGUAGES[(currentIdx + i) % LANGUAGES.length]
    if (candidate !== exclude) return candidate
  }
  return current
}
```

- [ ] **Step 2: Commit**

```bash
git add src/glasses/settings.ts
git commit -m "feat: add glasses settings screen with language cycling"
```

---

## Task 16: Plugin Glasses Listen Mode

**Files:**
- Create: `src/glasses/listen.ts`

- [ ] **Step 1: Implement listen mode**

```typescript
// src/glasses/listen.ts
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { createTextPage, updateText, formatListenDisplay } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import { SttClient } from '../services/stt'

interface CommittedPair {
  original: string
  translation: string
}

let sttClient: SttClient | null = null
let committedPairs: CommittedPair[] = []
let partialText = ''
let currentSessionId: string | null = null
let pendingSentences: string[] = []
let silenceTimer: ReturnType<typeof setTimeout> | null = null

const DISPLAY_CONTAINER_ID = 0
const SILENCE_PARAGRAPH_DELAY_MS = 2000

export async function startListening(bridge: EvenAppBridge, api: ApiClient): Promise<void> {
  appState.navigateTo('listen')
  committedPairs = []
  partialText = ''
  pendingSentences = []

  // Create display
  createTextPage(bridge, [
    { text: 'Starting...', isEventCapture: true },
  ])

  // Create session on server
  const session = await api.createSession(
    appState.settings.listen_lang,
    appState.settings.translate_lang
  )
  currentSessionId = session.id

  // Get STT token
  const { token } = await api.getSttToken()

  // Start STT
  sttClient = new SttClient(token, { language: appState.settings.listen_lang })

  sttClient.onPartialTranscript((text) => {
    partialText = text
    renderDisplay(bridge)
  })

  sttClient.onCommittedTranscript((text) => {
    partialText = ''
    handleCommittedSentence(bridge, api, text)
  })

  sttClient.onError((err) => {
    updateText(bridge, DISPLAY_CONTAINER_ID, `Error: ${err.message}`)
  })

  sttClient.connect()

  // Start audio capture
  bridge.audioControl(true)
}

async function handleCommittedSentence(
  bridge: EvenAppBridge,
  api: ApiClient,
  sentence: string
): Promise<void> {
  // Translate immediately
  try {
    const translation = await api.translate(
      sentence,
      appState.settings.listen_lang,
      appState.settings.translate_lang
    )
    committedPairs.push({ original: sentence, translation })
    renderDisplay(bridge)
  } catch {
    // Show original without translation on error
    committedPairs.push({ original: sentence, translation: '[Translation error]' })
    renderDisplay(bridge)
  }

  // Accumulate sentences for paragraph saving
  pendingSentences.push(sentence)

  // Reset silence timer for paragraph grouping
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = setTimeout(() => flushParagraph(api), SILENCE_PARAGRAPH_DELAY_MS)
}

async function flushParagraph(api: ApiClient): Promise<void> {
  if (!currentSessionId || pendingSentences.length === 0) return

  const original = pendingSentences.join(' ')
  pendingSentences = []

  try {
    const translation = await api.translate(
      original,
      appState.settings.listen_lang,
      appState.settings.translate_lang
    )
    await api.appendParagraph(currentSessionId, original, translation)
  } catch {
    // Best-effort save — don't interrupt the user
  }
}

function renderDisplay(bridge: EvenAppBridge): void {
  const text = formatListenDisplay(committedPairs, partialText)
  updateText(bridge, DISPLAY_CONTAINER_ID, text)
}

export async function stopListening(bridge: EvenAppBridge, api: ApiClient): Promise<void> {
  bridge.audioControl(false)
  sttClient?.disconnect()
  sttClient = null

  // Flush any pending paragraph
  if (silenceTimer) clearTimeout(silenceTimer)
  await flushParagraph(api)

  currentSessionId = null
}

export function handleListenEvent(
  bridge: EvenAppBridge,
  eventType: number,
  api: ApiClient,
  onBack: () => void
): void {
  // DOUBLE_CLICK_EVENT = 3 → stop and go back
  if (eventType === 3) {
    stopListening(bridge, api).then(onBack)
  }
}

// Called when bridge delivers audio data
export function handleAudioData(pcmData: ArrayBuffer): void {
  sttClient?.sendAudio(pcmData)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/glasses/listen.ts
git commit -m "feat: add glasses listen mode with real-time STT and translation"
```

---

## Task 17: Plugin Glasses History

**Files:**
- Create: `src/glasses/history.ts`

- [ ] **Step 1: Implement history screens**

```typescript
// src/glasses/history.ts
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { createListPage, createTextPage, updateText, formatHistoryDetail } from './renderer'
import { appState } from '../services/state'
import { ApiClient } from '../services/api'
import type { Session, Paragraph } from '../types'

let sessions: Session[] = []
let sessionCursor: string | null = null
let currentParagraphs: Paragraph[] = []
let paragraphCursor: number | null = null
let currentParagraphIndex = 0

export async function showHistoryList(bridge: EvenAppBridge, api: ApiClient): Promise<void> {
  appState.navigateTo('history_list')
  sessions = []
  sessionCursor = null
  await loadMoreSessions(api)
  renderHistoryList(bridge)
}

async function loadMoreSessions(api: ApiClient): Promise<void> {
  const result = await api.listSessions(sessionCursor ?? undefined)
  sessions = sessions.concat(result.sessions)
  sessionCursor = result.cursor
}

function renderHistoryList(bridge: EvenAppBridge): void {
  if (sessions.length === 0) {
    createListPage(bridge, [{ text: 'No sessions yet' }])
    return
  }
  const items = sessions.map(s => {
    const date = new Date(s.created_at)
    const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
    const preview = s.preview ?? 'Empty session'
    return { text: `${dateStr} ${preview}`.slice(0, 64) }
  })
  createListPage(bridge, items)
}

export async function showSessionDetail(
  bridge: EvenAppBridge,
  api: ApiClient,
  sessionIndex: number
): Promise<void> {
  appState.navigateTo('history_detail')
  currentParagraphs = []
  paragraphCursor = null
  currentParagraphIndex = 0

  const session = sessions[sessionIndex]
  if (!session) return

  const result = await api.getSession(session.id)
  currentParagraphs = result.paragraphs
  paragraphCursor = result.cursor ? Number(result.cursor) : null

  renderSessionDetail(bridge)
}

function renderSessionDetail(bridge: EvenAppBridge): void {
  if (currentParagraphs.length === 0) {
    createTextPage(bridge, [{ text: 'Empty session', isEventCapture: true }])
    return
  }
  const text = formatHistoryDetail(currentParagraphs, currentParagraphIndex)
  createTextPage(bridge, [{ text, isEventCapture: true }])
}

export function handleHistoryListEvent(
  bridge: EvenAppBridge,
  eventType: number,
  selectedIndex: number,
  api: ApiClient,
  onBack: () => void
): void {
  // DOUBLE_CLICK_EVENT = 3 → back to menu
  if (eventType === 3) {
    onBack()
    return
  }

  // CLICK_EVENT = 0 → open session
  if (eventType === 0) {
    showSessionDetail(bridge, api, selectedIndex)
  }
}

export function handleHistoryDetailEvent(
  bridge: EvenAppBridge,
  eventType: number,
  api: ApiClient,
  onBack: () => void
): void {
  // DOUBLE_CLICK_EVENT = 3 → back to list
  if (eventType === 3) {
    showHistoryList(bridge, api)
    return
  }

  // SCROLL_TOP_EVENT = 1 → previous paragraph
  if (eventType === 1 && currentParagraphIndex > 0) {
    currentParagraphIndex--
    const text = formatHistoryDetail(currentParagraphs, currentParagraphIndex)
    updateText(bridge, 0, text)
  }

  // SCROLL_BOTTOM_EVENT = 2 → next paragraph
  if (eventType === 2 && currentParagraphIndex < currentParagraphs.length - 1) {
    currentParagraphIndex++
    const text = formatHistoryDetail(currentParagraphs, currentParagraphIndex)
    updateText(bridge, 0, text)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/glasses/history.ts
git commit -m "feat: add glasses history list and detail screens"
```

---

## Task 18: Plugin Main Entry Point (Wire Everything)

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Implement full app initialization and event routing**

```typescript
// src/main.ts
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { appState } from './services/state'
import { ApiClient } from './services/api'
import { showMenu, handleMenuEvent } from './glasses/menu'
import { startListening, handleListenEvent, handleAudioData } from './glasses/listen'
import { showHistoryList, handleHistoryListEvent, handleHistoryDetailEvent } from './glasses/history'
import { showSettings, handleSettingsEvent } from './glasses/settings'

// TODO: Replace with actual worker URL after first deploy
const WORKER_URL = 'https://notewriter-worker.<your-subdomain>.workers.dev'

const api = new ApiClient(WORKER_URL)

async function init() {
  const bridge = await waitForEvenAppBridge()

  // Get device ID from SDK
  // The SDK provides device info via status events or bridge methods
  const deviceId = await getDeviceId(bridge)
  appState.setDeviceId(deviceId)

  // Register or restore auth token
  const storedToken = bridge.getLocalStorage('auth_token')
  if (storedToken) {
    appState.setAuthToken(storedToken)
    api.setToken(storedToken)
  } else {
    try {
      const { token } = await api.register(deviceId)
      appState.setAuthToken(token)
      api.setToken(token)
      bridge.setLocalStorage('auth_token', token)
    } catch (err) {
      // Device may already be registered — try to re-register
      // In production, add a recovery flow
      console.error('Registration failed:', err)
    }
  }

  // Load settings from server
  try {
    const settings = await api.getSettings()
    appState.updateSettings(settings)
  } catch { /* use defaults */ }

  // Check if keys are configured
  try {
    const keys = await api.getKeys()
    appState.setKeysConfigured(keys.elevenlabs_key !== null && keys.aws_access_key_id !== null)
  } catch { /* not configured */ }

  // Show main menu
  showMenu(bridge)

  // Handle all events from glasses
  bridge.onEvenHubEvent((event: any) => {
    // Audio data
    if (event.audioEvent?.audioPcm) {
      handleAudioData(event.audioEvent.audioPcm)
      return
    }

    // UI events
    const eventType = event.textEvent?.eventType ?? event.listEvent?.eventType
    const selectedIndex = event.listEvent?.selectedIndex ?? 0

    if (eventType === undefined) return

    // Lifecycle events
    if (eventType === 4) { // FOREGROUND_ENTER_EVENT
      // Refresh settings on resume
      api.getSettings().then(s => appState.updateSettings(s)).catch(() => {})
      api.getKeys().then(k => {
        appState.setKeysConfigured(k.elevenlabs_key !== null && k.aws_access_key_id !== null)
      }).catch(() => {})
      return
    }

    // Route events to current screen handler
    switch (appState.currentScreen) {
      case 'menu':
        handleMenuEvent(bridge, eventType, selectedIndex, {
          onListen: () => startListening(bridge, api),
          onHistory: () => showHistoryList(bridge, api),
          onSettings: () => showSettings(bridge),
        })
        break

      case 'listen':
        handleListenEvent(bridge, eventType, api, () => showMenu(bridge))
        break

      case 'history_list':
        handleHistoryListEvent(bridge, eventType, selectedIndex, api, () => showMenu(bridge))
        break

      case 'history_detail':
        handleHistoryDetailEvent(bridge, eventType, api, () => showHistoryList(bridge, api))
        break

      case 'settings':
        handleSettingsEvent(bridge, eventType, selectedIndex, api, () => showMenu(bridge))
        break
    }
  })
}

async function getDeviceId(bridge: EvenAppBridge): Promise<string> {
  // Try to get device ID from SDK's stored info
  const stored = bridge.getLocalStorage('device_id')
  if (stored) return stored

  // Generate and persist a unique ID
  const id = crypto.randomUUID()
  bridge.setLocalStorage('device_id', id)
  return id
}

init()
```

- [ ] **Step 2: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire up main entry point with event routing"
```

---

## Task 19: Phone Web UI — HTML Shell + Keys

**Files:**
- Create: `src/phone/index.html`
- Create: `src/phone/keys.ts`

- [ ] **Step 1: Create phone UI HTML**

```html
<!-- src/phone/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NoteWriter Settings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; background: #f5f5f5; color: #333; }
    .tabs { display: flex; gap: 0; margin-bottom: 16px; }
    .tab { flex: 1; padding: 12px; text-align: center; background: #ddd; border: none; font-size: 14px; cursor: pointer; }
    .tab.active { background: #007aff; color: white; }
    .tab:first-child { border-radius: 8px 0 0 8px; }
    .tab:last-child { border-radius: 0 8px 8px 0; }
    .panel { display: none; }
    .panel.active { display: block; }
    label { display: block; font-size: 13px; color: #666; margin-bottom: 4px; margin-top: 12px; }
    input, select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 16px; }
    button.save { width: 100%; padding: 12px; margin-top: 16px; background: #007aff; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
    button.save:disabled { background: #ccc; }
    .session-item { background: white; padding: 12px; border-radius: 8px; margin-bottom: 8px; cursor: pointer; }
    .session-date { font-size: 12px; color: #999; }
    .session-preview { font-size: 14px; margin-top: 4px; }
    .paragraph { margin-bottom: 16px; }
    .paragraph .original { font-weight: 500; }
    .paragraph .translation { color: #666; margin-top: 4px; }
    .back-btn { background: none; border: none; color: #007aff; font-size: 14px; cursor: pointer; margin-bottom: 12px; }
    .status { text-align: center; padding: 8px; font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <div class="tabs">
    <button class="tab active" data-panel="keys">Keys</button>
    <button class="tab" data-panel="history">History</button>
    <button class="tab" data-panel="settings">Settings</button>
  </div>

  <div id="keys" class="panel active">
    <label>ElevenLabs API Key</label>
    <input type="password" id="el-key" placeholder="Enter key..." />
    <label>AWS Access Key ID</label>
    <input type="password" id="aws-key-id" placeholder="AKIA..." />
    <label>AWS Secret Access Key</label>
    <input type="password" id="aws-secret" placeholder="Enter secret..." />
    <label>AWS Region</label>
    <select id="aws-region">
      <option value="eu-west-1">eu-west-1 (Ireland)</option>
      <option value="us-east-1">us-east-1 (N. Virginia)</option>
      <option value="us-west-2">us-west-2 (Oregon)</option>
      <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
      <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
    </select>
    <button class="save" id="save-keys">Save</button>
    <div class="status" id="keys-status"></div>
  </div>

  <div id="history" class="panel">
    <div id="history-list"></div>
    <div id="history-detail" style="display:none;">
      <button class="back-btn" id="history-back">&larr; Back</button>
      <div id="history-content"></div>
    </div>
  </div>

  <div id="settings" class="panel">
    <label>Listen language</label>
    <select id="listen-lang">
      <option value="en">English</option>
      <option value="el">Greek</option>
      <option value="fr">French</option>
      <option value="de">German</option>
    </select>
    <label>Translate to</label>
    <select id="translate-lang">
      <option value="el">Greek</option>
      <option value="en">English</option>
      <option value="fr">French</option>
      <option value="de">German</option>
    </select>
    <button class="save" id="save-settings">Save</button>
    <div class="status" id="settings-status"></div>
  </div>

  <script type="module" src="./phone-main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/phone/phone-main.ts`**

```typescript
// src/phone/phone-main.ts
import { ApiClient } from '../services/api'
import { initKeys } from './keys'
import { initHistory } from './history'
import { initSettings } from './settings'

const WORKER_URL = 'https://notewriter-worker.<your-subdomain>.workers.dev'
const api = new ApiClient(WORKER_URL)

// Restore auth token from localStorage
const token = localStorage.getItem('notewriter_auth_token')
if (token) {
  api.setToken(token)
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    const panelId = (tab as HTMLElement).dataset.panel!
    document.getElementById(panelId)!.classList.add('active')
  })
})

// Initialize all tabs
initKeys(api)
initHistory(api)
initSettings(api)
```

- [ ] **Step 3: Implement keys tab**

```typescript
// src/phone/keys.ts
import { ApiClient } from '../services/api'

export function initKeys(api: ApiClient): void {
  const elKey = document.getElementById('el-key') as HTMLInputElement
  const awsKeyId = document.getElementById('aws-key-id') as HTMLInputElement
  const awsSecret = document.getElementById('aws-secret') as HTMLInputElement
  const awsRegion = document.getElementById('aws-region') as HTMLSelectElement
  const saveBtn = document.getElementById('save-keys') as HTMLButtonElement
  const status = document.getElementById('keys-status')!

  // Load current masked keys
  api.getKeys().then(keys => {
    if (keys.elevenlabs_key) elKey.placeholder = keys.elevenlabs_key
    if (keys.aws_access_key_id) awsKeyId.placeholder = keys.aws_access_key_id
    if (keys.aws_region) awsRegion.value = keys.aws_region
  }).catch(() => {})

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true
    status.textContent = 'Saving...'
    try {
      await api.saveKeys({
        elevenlabs_key: elKey.value,
        aws_access_key_id: awsKeyId.value,
        aws_secret_access_key: awsSecret.value,
        aws_region: awsRegion.value,
      })
      status.textContent = 'Saved!'
      elKey.value = ''
      awsKeyId.value = ''
      awsSecret.value = ''
      // Refresh masked placeholders
      const keys = await api.getKeys()
      if (keys.elevenlabs_key) elKey.placeholder = keys.elevenlabs_key
      if (keys.aws_access_key_id) awsKeyId.placeholder = keys.aws_access_key_id
    } catch (err) {
      status.textContent = `Error: ${err instanceof Error ? err.message : 'Failed'}`
    } finally {
      saveBtn.disabled = false
    }
  })
}
```

- [ ] **Step 4: Commit**

```bash
git add src/phone/
git commit -m "feat: add phone web UI shell and keys tab"
```

---

## Task 20: Phone Web UI — History + Settings

**Files:**
- Create: `src/phone/history.ts`
- Create: `src/phone/settings.ts`

- [ ] **Step 1: Implement history tab**

```typescript
// src/phone/history.ts
import { ApiClient } from '../services/api'

export function initHistory(api: ApiClient): void {
  const listEl = document.getElementById('history-list')!
  const detailEl = document.getElementById('history-detail')!
  const contentEl = document.getElementById('history-content')!
  const backBtn = document.getElementById('history-back')!

  loadSessions()

  async function loadSessions() {
    listEl.innerHTML = '<div class="status">Loading...</div>'
    try {
      const result = await api.listSessions()
      if (result.sessions.length === 0) {
        listEl.innerHTML = '<div class="status">No sessions yet</div>'
        return
      }
      listEl.innerHTML = ''
      for (const session of result.sessions) {
        const item = document.createElement('div')
        item.className = 'session-item'
        const date = new Date(session.created_at)
        item.innerHTML = `
          <div class="session-date">${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div class="session-preview">${session.preview ?? 'Empty session'}</div>
        `
        item.addEventListener('click', () => showDetail(session.id))
        listEl.appendChild(item)
      }
    } catch {
      listEl.innerHTML = '<div class="status">Failed to load sessions</div>'
    }
  }

  async function showDetail(sessionId: string) {
    listEl.style.display = 'none'
    detailEl.style.display = 'block'
    contentEl.innerHTML = '<div class="status">Loading...</div>'

    try {
      const result = await api.getSession(sessionId)
      contentEl.innerHTML = ''
      for (const p of result.paragraphs) {
        const div = document.createElement('div')
        div.className = 'paragraph'
        div.innerHTML = `
          <div class="original">${escapeHtml(p.original)}</div>
          <div class="translation">${escapeHtml(p.translation)}</div>
        `
        contentEl.appendChild(div)
      }
    } catch {
      contentEl.innerHTML = '<div class="status">Failed to load session</div>'
    }
  }

  backBtn.addEventListener('click', () => {
    detailEl.style.display = 'none'
    listEl.style.display = 'block'
  })
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
```

- [ ] **Step 2: Implement settings tab**

```typescript
// src/phone/settings.ts
import { ApiClient } from '../services/api'

export function initSettings(api: ApiClient): void {
  const listenLang = document.getElementById('listen-lang') as HTMLSelectElement
  const translateLang = document.getElementById('translate-lang') as HTMLSelectElement
  const saveBtn = document.getElementById('save-settings') as HTMLButtonElement
  const status = document.getElementById('settings-status')!

  // Load current settings
  api.getSettings().then(settings => {
    listenLang.value = settings.listen_lang
    translateLang.value = settings.translate_lang
  }).catch(() => {})

  saveBtn.addEventListener('click', async () => {
    if (listenLang.value === translateLang.value) {
      status.textContent = 'Languages must be different'
      return
    }
    saveBtn.disabled = true
    status.textContent = 'Saving...'
    try {
      await api.saveSettings({
        listen_lang: listenLang.value as any,
        translate_lang: translateLang.value as any,
      })
      status.textContent = 'Saved!'
    } catch (err) {
      status.textContent = `Error: ${err instanceof Error ? err.message : 'Failed'}`
    } finally {
      saveBtn.disabled = false
    }
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/phone/history.ts src/phone/settings.ts
git commit -m "feat: add phone history viewer and settings tabs"
```

---

## Task 21: CI/CD — GitHub Actions

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `.github/workflows/pr.yml`

- [ ] **Step 1: Create deploy workflow**

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install plugin dependencies
        run: npm ci

      - name: Install worker dependencies
        run: cd worker && npm ci

      - name: Run worker tests
        run: cd worker && npm test

      - name: Run plugin tests
        run: npm test

      - name: Build plugin
        run: npm run build:plugin

      - name: Install Even Hub CLI
        run: npm install -g @evenrealities/evenhub-cli

      - name: Pack plugin
        run: evenhub pack app.json dist -o notewriter.ehpk

      - name: Deploy worker
        run: cd worker && npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Apply D1 migrations
        run: cd worker && npx wrangler d1 migrations apply notewriter-db --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Upload .ehpk artifact
        uses: actions/upload-artifact@v4
        with:
          name: notewriter-ehpk
          path: notewriter.ehpk
```

- [ ] **Step 2: Create PR workflow**

```yaml
# .github/workflows/pr.yml
name: PR Check

on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install plugin dependencies
        run: npm ci

      - name: Install worker dependencies
        run: cd worker && npm ci

      - name: Run worker tests
        run: cd worker && npm test

      - name: Run plugin tests
        run: npm test

      - name: Build plugin
        run: npm run build:plugin

      - name: Build worker (dry-run)
        run: cd worker && npx wrangler deploy --dry-run --outdir=dist
```

- [ ] **Step 3: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions for deploy and PR checks"
```

---

## Task 22: Final Integration — Vite Multi-Page Config + Smoke Test

**Files:**
- Modify: `vite.config.ts`
- Modify: `index.html`

- [ ] **Step 1: Update Vite config for multi-page build**

The plugin has two entry points: `index.html` (glasses/main) and `src/phone/index.html` (phone UI). Update Vite to handle both:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        phone: resolve(__dirname, 'src/phone/index.html'),
      },
    },
  },
})
```

- [ ] **Step 2: Verify full build**

Run: `npm run build:plugin`
Expected: `dist/` contains both `index.html` and `src/phone/index.html` with bundled JS.

Run: `cd worker && npm test`
Expected: All worker tests pass.

Run: `npm test`
Expected: All plugin tests pass.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat: configure multi-page Vite build for glasses and phone UI"
```

---

## Summary

| Task | Component | Description |
|---|---|---|
| 1 | Scaffolding | Project structure, deps, configs |
| 2 | Worker/DB | D1 schema migration |
| 3 | Worker/Crypto | AES-256 encrypt/decrypt, token hashing |
| 4 | Worker/Auth | Device registration + Bearer token |
| 5 | Worker/Keys | Encrypted API keys CRUD |
| 6 | Worker/Settings | Language settings CRUD |
| 7 | Worker/Sessions | Sessions + paragraphs CRUD with pagination |
| 8 | Worker/Translate | Amazon Translate proxy via aws4fetch |
| 9 | Worker/STT Token | ElevenLabs temporary token minting |
| 10 | Plugin/State | App state management |
| 11 | Plugin/API | HTTP client for all Worker endpoints |
| 12 | Plugin/STT | ElevenLabs WebSocket client |
| 13 | Plugin/Renderer | Glasses display rendering helpers |
| 14 | Plugin/Menu | Main menu screen |
| 15 | Plugin/Settings | Glasses settings screen |
| 16 | Plugin/Listen | Listen mode (STT + translate + display) |
| 17 | Plugin/History | History list + detail screens |
| 18 | Plugin/Main | Wire everything together |
| 19 | Phone/Keys | Phone UI shell + API keys form |
| 20 | Phone/History+Settings | Phone history viewer + settings |
| 21 | CI/CD | GitHub Actions deploy + PR workflows |
| 22 | Integration | Multi-page Vite config + smoke test |
