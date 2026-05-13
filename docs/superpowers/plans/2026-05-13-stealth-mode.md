# Stealth Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stealth" glasses mode that records and transcribes speech with only a blinking dot on screen, then translates everything server-side after the session ends.

**Architecture:** New `src/glasses/stealth.ts` mirrors `listen.ts` but suppresses all display output except an indicator dot; paragraphs are saved without translation during recording. On exit, a new `POST /api/sessions/:id/finalize` worker endpoint translates all empty paragraphs in the background via `ctx.waitUntil`. Phone History skips auto-translate for stealth sessions.

**Tech Stack:** TypeScript, Vite, Cloudflare Workers (D1, KV), ElevenLabs Scribe v2 Realtime WebSocket, Vitest

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `src/services/state.ts` | Add `'stealth'` to `Screen` union |
| Modify | `worker/src/sessions.ts` | Add `mode: string` to `Session` interface |
| Modify | `src/services/api.ts` | Add `finalizeSession()` method |
| Create | `src/__tests__/services/api.test.ts` | Test for `finalizeSession` |
| Modify | `worker/src/index.ts` | Add finalize route |
| Modify | `worker/src/__tests__/sessions.test.ts` | Test for finalize route |
| Create | `src/glasses/stealth.ts` | Full Stealth mode implementation |
| Modify | `src/glasses/menu.ts` | Add Stealth item, update indices + callback type |
| Modify | `src/main.ts` | Import stealth, audio routing, switch case, resetAll, callbacks |
| Modify | `src/phone/history.ts` | Skip auto-translate for stealth sessions |
| Modify | `src/phone/index.html` | Add gpt-4.1 and o4-mini to model selector |

---

## Task 1: Add `'stealth'` to Screen type and `mode` to worker Session interface

**Files:**
- Modify: `src/services/state.ts:3`
- Modify: `worker/src/sessions.ts:1-8`

- [ ] **Step 1: Update Screen type in state.ts**

In `src/services/state.ts`, change line 3:
```ts
export type Screen = 'menu' | 'listen' | 'history_list' | 'history_detail' | 'settings' | 'dialogue' | 'notes_list' | 'notes_detail' | 'stealth'
```

- [ ] **Step 2: Add mode field to worker Session interface**

In `worker/src/sessions.ts`, change the `Session` interface (lines 1-8):
```ts
export interface Session {
  id: string
  device_id: string
  created_at: string
  listen_lang: string
  translate_lang: string
  preview: string | null
  mode: string
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npx tsc --noEmit
```
Expected: no errors related to `Screen` or `Session`.

- [ ] **Step 4: Commit**

```bash
git add src/services/state.ts worker/src/sessions.ts
git commit -m "feat: add 'stealth' to Screen type, mode field to worker Session interface"
```

---

## Task 2: Add `finalizeSession` to ApiClient

**Files:**
- Modify: `src/services/api.ts`
- Modify: `src/__tests__/services/api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/services/api.test.ts` inside the `describe('ApiClient', ...)` block:
```ts
it('finalizeSession POSTs to finalize endpoint', async () => {
  client.setToken('tok')
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
  await client.finalizeSession('session-123')
  expect(fetch).toHaveBeenCalledWith(
    'https://worker.example.com/api/sessions/session-123/finalize',
    expect.objectContaining({ method: 'POST' })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npm test -- --reporter=verbose 2>&1 | grep -A5 "finalizeSession"
```
Expected: FAIL — `client.finalizeSession is not a function`

- [ ] **Step 3: Add the method to ApiClient**

In `src/services/api.ts`, add after `deleteNote`:
```ts
async finalizeSession(id: string): Promise<void> {
  await this.request<{}>(`/api/sessions/${id}/finalize`, { method: 'POST' })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A5 "finalizeSession"
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api.ts src/__tests__/services/api.test.ts
git commit -m "feat: add finalizeSession to ApiClient"
```

---

## Task 3: Worker — finalize route

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/src/__tests__/sessions.test.ts`

- [ ] **Step 1: Check existing sessions test to understand test style**

```bash
cat "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter/worker/src/__tests__/sessions.test.ts"
```

- [ ] **Step 2: Write the failing test**

Add to `worker/src/__tests__/sessions.test.ts` (adapt to the existing mock/env pattern in that file):
```ts
it('POST /api/sessions/:id/finalize returns 200 immediately', async () => {
  // Create a session first
  const createRes = await worker.fetch(
    new Request('http://example.com/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ listen_lang: 'en', translate_lang: 'el', mode: 'stealth' }),
    }),
    env, ctx
  )
  const { id } = await createRes.json<{ id: string }>()

  const res = await worker.fetch(
    new Request(`http://example.com/api/sessions/${id}/finalize`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    }),
    env, ctx
  )
  expect(res.status).toBe(200)
})

it('POST /api/sessions/:id/finalize returns 404 for unknown session', async () => {
  const res = await worker.fetch(
    new Request('http://example.com/api/sessions/nonexistent/finalize', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    }),
    env, ctx
  )
  expect(res.status).toBe(404)
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter/worker"
npm test 2>&1 | grep -A3 "finalize"
```
Expected: FAIL — route not found (404 for both)

- [ ] **Step 4: Add the finalize route to worker/src/index.ts**

Add this block **before** the `const sessionMatch = ...` line (currently line 288):
```ts
// Finalize route — must be before general sessionMatch
const finalizeMatch = path.match(/^\/api\/sessions\/([^/]+)\/finalize$/)
if (finalizeMatch && request.method === 'POST') {
  const sessionId = finalizeMatch[1]
  // Verify ownership synchronously
  const session = await getSession(sessionId, deviceId, null, 1, env.DB)
  if (!session) return json({ error: 'Session not found' }, 404)

  // Respond immediately, translate in background
  ctx.waitUntil((async () => {
    const paragraphs = await env.DB.prepare(
      "SELECT id, original FROM paragraphs WHERE session_id = ? AND (translation IS NULL OR translation = '')"
    ).bind(sessionId).all<{ id: string; original: string }>()

    if (paragraphs.results.length === 0) return

    const settings = await getSettings(deviceId, env.DB)
    const provider = settings?.translate_provider ?? 'amazon'
    const model = settings?.translate_model ?? 'gpt-4o-mini'
    const keys = await getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)

    if (!keys) {
      ctx.waitUntil(writeLog(deviceId, { event: 'finalize', data: { error: 'keys_not_configured', session_id: sessionId } }, env.DB))
      return
    }

    const sourceLang = session.session.listen_lang
    const targetLang = session.session.translate_lang

    for (const para of paragraphs.results) {
      try {
        let translated: string
        if (provider === 'openai') {
          if (!keys.openai_key) continue
          translated = await translateWithOpenAI(para.original, sourceLang, targetLang, keys.openai_key, model)
        } else {
          translated = await translateText(para.original, sourceLang, targetLang, keys.aws_access_key_id, keys.aws_secret_access_key, keys.aws_region)
        }
        await updateParagraphTranslation(para.id, translated, env.DB)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        ctx.waitUntil(writeLog(deviceId, { event: 'finalize_para_err', data: { para_id: para.id, error: msg } }, env.DB))
      }
    }
    ctx.waitUntil(writeLog(deviceId, { event: 'finalize', data: { session_id: sessionId, count: paragraphs.results.length }, status: 200 }, env.DB))
  })())

  return json({ ok: true })
}
```

Also add `getSettings` and `updateParagraphTranslation` to the import from `'./sessions'` at the top of `index.ts`:
```ts
import { createSession, listSessions, getSession, appendParagraph, updateParagraphTranslation, deleteSession } from './sessions'
```
And add `getSettings` to the import from `'./settings'`:
```ts
import { getSettings, updateSettings } from './settings'
```
Both are already imported — verify they are; if not, add them.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter/worker"
npm test 2>&1 | grep -A3 "finalize"
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
git add worker/src/index.ts worker/src/__tests__/sessions.test.ts
git commit -m "feat: add POST /api/sessions/:id/finalize worker route"
```

---

## Task 4: Create src/glasses/stealth.ts

**Files:**
- Create: `src/glasses/stealth.ts`

This is the core of the feature. It is modelled directly on `listen.ts`. Read `src/glasses/listen.ts` in full before implementing.

- [ ] **Step 1: Create stealth.ts**

Create `src/glasses/stealth.ts` with the following complete implementation:

```ts
// src/glasses/stealth.ts
import { setMenuContent } from './renderer'
import { appState } from '../services/state'
import { SttClient } from '../services/stt'
import { ApiClient } from '../services/api'
import { log } from '../services/logger'

type StealthState = 'active' | 'paused'

let stealthState: StealthState = 'active'
let sttClient: SttClient | null = null
let currentBridge: any = null
let currentApi: ApiClient | null = null
let indicatorTimer: ReturnType<typeof setInterval> | null = null
let indicatorFrame = 0
let saveQueue: Promise<any> = Promise.resolve()

function enqueueSave(fn: () => Promise<any>): void {
  saveQueue = saveQueue.then(fn, fn)
}

function isNoise(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^\(.*\)$/.test(t)) return true
  if (/^\[.*\]$/.test(t)) return true
  if (/^\{.*\}$/.test(t)) return true
  if (/^[*].*[*]$/.test(t)) return true
  return false
}

function updateDisplay(): void {
  if (!currentBridge) return
  if (stealthState === 'paused') {
    setMenuContent(currentBridge, '‖')
    return
  }
  const dot = indicatorFrame % 2 === 0 ? '●' : ' '
  setMenuContent(currentBridge, dot)
}

function startIndicator(): void {
  if (indicatorTimer) return
  indicatorTimer = setInterval(() => {
    indicatorFrame++
    updateDisplay()
  }, 500)
}

function stopIndicator(): void {
  if (indicatorTimer !== null) { clearInterval(indicatorTimer); indicatorTimer = null }
}

function pauseStealth(): void {
  log('STEALTH', 'Paused')
  stealthState = 'paused'
  stopIndicator()
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch {}
  }
  sttClient?.disconnect()
  sttClient = null
  updateDisplay()
}

async function resumeStealth(): Promise<void> {
  if (!currentBridge || !currentApi) return
  log('STEALTH', 'Resuming')
  stealthState = 'active'

  setMenuContent(currentBridge, '...')

  try {
    const { token } = await currentApi.getSttToken()
    sttClient = new SttClient(token, { language: appState.settings.listenLang })

    sttClient.onCommittedTranscript((text) => {
      if (isNoise(text)) return
      log('STEALTH', `Committed: "${text.slice(0, 60)}"`)
      enqueueSave(async () => {
        const sessionId = appState.currentSessionId
        if (!sessionId) return
        try {
          await currentApi!.appendParagraph(sessionId, text, '')
          window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
        } catch (e) {
          log('ERR', `Stealth paragraph save failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      })
    })

    sttClient.onPartialTranscript(() => {}) // discard — no display
    sttClient.onError(() => {})
    sttClient.onStatus(() => {})

    sttClient.connect()
    currentBridge.audioControl(true)
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('ERR', `Stealth resume failed: ${msg}`)
    stealthState = 'paused'
    setMenuContent(currentBridge, `! Error\nClick retry`)
  }
}

export function resetStealth(): void {
  stopIndicator()
  if (currentBridge) {
    try { currentBridge.audioControl(false) } catch {}
  }
  sttClient?.disconnect()
  sttClient = null
  stealthState = 'active'
  indicatorFrame = 0
  saveQueue = Promise.resolve()
  appState.currentSessionId = null
  currentBridge = null
  currentApi = null
}

export async function startStealth(bridge: any, api: ApiClient): Promise<void> {
  appState.navigateTo('stealth')
  currentBridge = bridge
  currentApi = api
  stealthState = 'active'
  indicatorFrame = 0
  saveQueue = Promise.resolve()

  setMenuContent(bridge, 'Connecting...')

  try {
    const session = await api.createSession(
      appState.settings.listenLang,
      appState.settings.translateLang,
      'stealth'
    )
    appState.currentSessionId = session.id
    log('STEALTH', `Session created id=${session.id}`)
    window.dispatchEvent(new CustomEvent('notewriter:session-created'))

    const { token } = await api.getSttToken()
    sttClient = new SttClient(token, { language: appState.settings.listenLang })

    sttClient.onCommittedTranscript((text) => {
      if (isNoise(text)) return
      log('STEALTH', `Committed: "${text.slice(0, 60)}"`)
      enqueueSave(async () => {
        const sessionId = appState.currentSessionId
        if (!sessionId) return
        try {
          await api.appendParagraph(sessionId, text, '')
          window.dispatchEvent(new CustomEvent('notewriter:session-updated'))
        } catch (e) {
          log('ERR', `Stealth paragraph save failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      })
    })

    sttClient.onPartialTranscript(() => {})
    sttClient.onError(() => {})
    sttClient.onStatus(() => {})

    sttClient.connect()
    bridge.audioControl(true)
    startIndicator()
    updateDisplay()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('ERR', `Stealth start failed: ${msg}`)
    setMenuContent(bridge, `Error: ${msg}\nDouble-click to go back.`)
  }
}

export function handleStealthEvent(
  bridge: any,
  eventType: number,
  api: ApiClient,
  onBack: () => void
): void {
  if (eventType === 3) { // DOUBLE_CLICK — exit from any state
    stopIndicator()
    if (currentBridge) {
      try { currentBridge.audioControl(false) } catch {}
    }
    sttClient?.disconnect()
    sttClient = null
    const sessionId = appState.currentSessionId
    // Await queue then finalize (fire-and-forget after queue drains)
    saveQueue.finally(() => {
      if (sessionId) api.finalizeSession(sessionId).catch(() => {})
    })
    onBack()
    return
  }
  if (stealthState === 'active' && eventType === 0) { // CLICK — pause
    pauseStealth()
    return
  }
  if (stealthState === 'paused' && eventType === 0) { // CLICK — resume
    resumeStealth()
    return
  }
}

export function handleStealthAudio(pcmData: any): void {
  if (stealthState !== 'active') return
  sttClient?.sendAudio(pcmData)
}
```

Note: `SttClient` is constructed with `{ language: appState.settings.listenLang }`. The `vad_silence_threshold_secs` is set inside `SttClient.connect()` via `URLSearchParams`. To use `1.5` instead of `0.5`, `SttClient` needs a config option — see Task 5.

- [ ] **Step 2: Add vad config to SttClient**

In `src/services/stt.ts`, update `SttConfig` and `connect()`:

Change line 3:
```ts
export interface SttConfig { language: string; vadSilenceThresholdSecs?: string }
```

In `connect()`, change the `params` construction (around line 81-87):
```ts
const params = new URLSearchParams({
  model_id: 'scribe_v2_realtime',
  token: this.token,
  audio_format: 'pcm_16000',
  commit_strategy: 'vad',
  vad_silence_threshold_secs: this.config.vadSilenceThresholdSecs ?? '0.5',
})
```

Update `startStealth` and `resumeStealth` in `stealth.ts` to pass the config:
```ts
sttClient = new SttClient(token, {
  language: appState.settings.listenLang,
  vadSilenceThresholdSecs: '1.5',
})
```
(Update both occurrences — in `startStealth` and in `resumeStealth`.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/glasses/stealth.ts src/services/stt.ts
git commit -m "feat: add stealth.ts — minimal-display recording mode with server-side translation"
```

---

## Task 5: Update menu.ts — add Stealth item

**Files:**
- Modify: `src/glasses/menu.ts`

- [ ] **Step 1: Update MENU_ITEMS and renderMenu**

Replace the entire contents of `src/glasses/menu.ts`:
```ts
// src/glasses/menu.ts
import { setMenuContent, formatMenuText } from './renderer'
import { appState } from '../services/state'

const MENU_ITEMS = ['Listen', 'Stealth', 'Dialogue', 'Notes', 'History', 'Settings']

let selectedIndex = 0
let menuShownAt = 0

export function showMenu(bridge: any): void {
  appState.navigateTo('menu')
  selectedIndex = 0
  menuShownAt = Date.now()
  renderMenu(bridge)
}

function renderMenu(bridge: any): void {
  const items = MENU_ITEMS.map((text) => {
    if ((text === 'Listen' || text === 'Stealth') && !appState.keysConfigured) {
      return `${text} (setup keys first)`
    }
    if (text === 'Dialogue' && (!appState.keysConfigured || !appState.openaiKeyConfigured)) {
      return `${text} (setup keys first)`
    }
    return text
  })
  setMenuContent(bridge, formatMenuText(items, selectedIndex))
}

export function handleMenuEvent(
  bridge: any,
  eventType: number,
  _selectedIndex: number,
  callbacks: {
    onListen: () => void
    onStealth: () => void
    onDialogue: () => void
    onNotes: () => void
    onHistory: () => void
    onSettings: () => void
    onExit: () => void
  }
): void {
  if (eventType === 3) { callbacks.onExit(); return }
  if (eventType === 1) { selectedIndex = Math.max(0, selectedIndex - 1); renderMenu(bridge); return }
  if (eventType === 2) { selectedIndex = Math.min(MENU_ITEMS.length - 1, selectedIndex + 1); renderMenu(bridge); return }
  if (eventType === 0) {
    if (Date.now() - menuShownAt < 2000) return
    switch (selectedIndex) {
      case 0: if (appState.keysConfigured) callbacks.onListen(); break
      case 1: if (appState.keysConfigured) callbacks.onStealth(); break
      case 2: if (appState.keysConfigured && appState.openaiKeyConfigured) callbacks.onDialogue(); break
      case 3: callbacks.onNotes(); break
      case 4: callbacks.onHistory(); break
      case 5: callbacks.onSettings(); break
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npx tsc --noEmit
```
Expected: error in `main.ts` — `onStealth` missing from callbacks object (will fix in Task 6).

- [ ] **Step 3: Commit**

```bash
git add src/glasses/menu.ts
git commit -m "feat: add Stealth to menu — index 1, keysConfigured guard, onStealth callback type"
```

---

## Task 6: Wire Stealth into main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add import**

Add to the imports at the top of `src/main.ts` (after the dialogue import):
```ts
import { startStealth, handleStealthEvent, handleStealthAudio, resetStealth } from './glasses/stealth'
```

- [ ] **Step 2: Add resetStealth to resetAll**

Change `resetAll` (around line 96):
```ts
function resetAll(): void {
  resetListen()
  resetDialogue()
  resetStealth()
  appState.navigateTo('menu')
}
```

- [ ] **Step 3: Add handleStealthAudio to the audio routing line**

Change line 130 (the audio event handler):
```ts
if (event.audioEvent?.audioPcm) { handleAudioData(event.audioEvent.audioPcm); handleDialogueAudio(event.audioEvent.audioPcm); handleStealthAudio(event.audioEvent.audioPcm); return }
```

- [ ] **Step 4: Add onStealth callback and case 'stealth' to the switch**

Change the `handleMenuEvent` call (around line 167) to add `onStealth`:
```ts
case 'menu': handleMenuEvent(bridge, eventType, selectedIndex, {
  onListen: () => navigateWithGuard(() => startListening(bridge, api)),
  onStealth: () => navigateWithGuard(() => startStealth(bridge, api)),
  onDialogue: () => navigateWithGuard(() => startDialogue(bridge, api)),
  onNotes: () => navigateWithGuard(() => showNotesList(bridge, api)),
  onHistory: () => navigateWithGuard(() => showHistoryList(bridge, api)),
  onSettings: () => navigateWithGuard(() => showSettings(bridge)),
  onExit: () => {
    resetAll()
    try { bridge.shutDownPageContainer(1) } catch {}
    resetPage()
    window.dispatchEvent(new CustomEvent('notewriter:glasses-stopped'))
  },
}); break
```

Add the `case 'stealth':` branch after `case 'listen':`:
```ts
case 'stealth': handleStealthEvent(bridge, eventType, api, () => navigateWithGuard(() => { resetAll(); showMenu(bridge) })); break
```

- [ ] **Step 5: Verify TypeScript compiles with no errors**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Run all tests**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire Stealth into main.ts — audio routing, switch case, resetAll, menu callbacks"
```

---

## Task 7: Phone History — skip auto-translate for stealth sessions

**Files:**
- Modify: `src/phone/history.ts`

- [ ] **Step 1: Add the mode guard**

In `src/phone/history.ts`, find the `renderParagraph` function (around line 173). Change:
```ts
// If translation is empty, translate on the fly
if (!para.translation && para.original) {
```
to:
```ts
// Skip auto-translate for stealth sessions — server finalize handles it
if (!para.translation && para.original && lastSession?.mode !== 'stealth') {
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npx tsc --noEmit
```
Expected: no errors (`Session.mode` is already `mode?: string` in `src/types.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/phone/history.ts
git commit -m "fix: skip phone auto-translate for stealth sessions — defer to server finalize"
```

---

## Task 8: Phone UI — add quality translation models

**Files:**
- Modify: `src/phone/index.html`

- [ ] **Step 1: Add model options**

In `src/phone/index.html`, find the `#keys-translate-model` select element. It currently has four options ending with `gpt-4.1-nano`. Add two more options after `gpt-4.1-nano`:
```html
<option value="gpt-4.1">GPT-4.1</option>
<option value="o4-mini">O4 Mini</option>
```

- [ ] **Step 2: Commit**

```bash
git add src/phone/index.html
git commit -m "feat: add gpt-4.1 and o4-mini to translation model selector"
```

---

## Task 9: Build, bump version, repack

- [ ] **Step 1: Build plugin**

```bash
cd "/Users/pitcha/Yandex.Disk.localized/Cursor Projects/NoteWriter"
npm run build:plugin
```
Expected: `✓ built in Xms` with no errors.

- [ ] **Step 2: Bump version in app.json**

In `app.json`, increment the patch version (e.g. `1.8.33` → `1.8.34`).

- [ ] **Step 3: Repack ehpk**

```bash
evenhub pack app.json dist -o notewriter.ehpk
```
Expected: `Successfully packed notewriter.ehpk (XXXXX bytes)`

- [ ] **Step 4: Final commit and push**

```bash
git add app.json
git commit -m "chore: bump version to 1.8.34, build Stealth mode"
git push
```

---

## Self-Review Checklist

Spec section → task coverage:

| Spec requirement | Covered by |
|-----------------|------------|
| `'stealth'` added to Screen type | Task 1 |
| `mode` added to worker Session interface | Task 1 |
| `finalizeSession` in ApiClient | Task 2 |
| Finalize worker route with ownership check | Task 3 |
| Finalize: `(translation IS NULL OR translation = '')` predicate | Task 3 |
| Finalize: `getCachedKeys`, `getSettings` | Task 3 |
| Finalize: missing keys logs error | Task 3 |
| Finalize: regex before `sessionMatch` | Task 3 |
| `stealth.ts` — blinking dot active display | Task 4 |
| `stealth.ts` — `‖` paused display | Task 4 |
| `stealth.ts` — click pause/resume | Task 4 |
| `stealth.ts` — double-click await queue + finalize + onBack | Task 4 |
| `stealth.ts` — `isNoise()` filtering | Task 4 |
| `stealth.ts` — `saveQueue` / `enqueueSave` | Task 4 |
| `stealth.ts` — fresh STT token on resume | Task 4 |
| `stealth.ts` — `vad_silence_threshold_secs: '1.5'` | Task 4 |
| `stealth.ts` — `session-created` / `session-updated` events | Task 4 |
| `stealth.ts` — `resetStealth()` clears bridge, STT, timer, sessionId | Task 4 |
| `stealth.ts` — error display on STT failure | Task 4 |
| `handleStealthAudio` guards on `stealthState !== 'active'` | Task 4 |
| Menu Stealth item at index 1 | Task 5 |
| Menu case 1 guard = `keysConfigured` only | Task 5 |
| `onStealth` in callbacks type | Task 5 |
| `navigateWithGuard` wraps `startStealth` | Task 6 |
| Audio routing: `handleStealthAudio` called unconditionally | Task 6 |
| `resetStealth` in `resetAll` | Task 6 |
| `case 'stealth'` in switch | Task 6 |
| Phone History: skip auto-translate for stealth | Task 7 |
| Phone UI: `gpt-4.1` and `o4-mini` model options | Task 8 |
