# Diagnostic Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side diagnostic logging to trace the STT→translate→save pipeline, with a downloadable log file from phone Settings UI.

**Architecture:** A singleton logger service stores timestamped entries in memory + localStorage. Instrumentation calls are added at critical pipeline points in stt.ts, listen.ts, and dialogue.ts. Phone settings gets a subtle "Log file" link that expands to Download/Clear controls.

**Tech Stack:** TypeScript, localStorage, Blob API

**Spec:** `docs/superpowers/specs/2026-04-16-diagnostic-logging-design.md`

---

### Task 1: Create logger service

**Files:**
- Create: `src/services/logger.ts`

- [ ] **Step 1: Create the logger module**

```typescript
// src/services/logger.ts

const STORAGE_KEY = 'notewriter:log'
const entries: string[] = []

function pad(n: number, len = 2): string { return String(n).padStart(len, '0') }

function timestamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

// Load existing entries from localStorage on module init
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) entries.push(...parsed)
  }
} catch {}

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch {}
}

export function log(tag: string, message: string): void {
  const entry = `[${timestamp()}] [${tag}] ${message}`
  entries.push(entry)
  persist()
}

export function download(): boolean {
  if (entries.length === 0) return false
  const text = entries.join('\n') + '\n'
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  a.href = url
  a.download = `notewriter-log-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return true
}

export function clear(): void {
  entries.length = 0
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

export function getEntries(): string[] {
  return entries
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/pitcha/Yandex.Disk.localized/Cursor\ Projects/NoteWriter && npx tsc --noEmit src/services/logger.ts`

If tsc doesn't work standalone, just verify no red squiggles or run the full build.

- [ ] **Step 3: Commit**

```bash
git add src/services/logger.ts
git commit -m "feat: add diagnostic logger service"
```

---

### Task 2: Instrument STT client

**Files:**
- Modify: `src/services/stt.ts`

- [ ] **Step 1: Add import at top of stt.ts**

Add after existing imports (line 1 area):

```typescript
import { log } from './logger'
```

- [ ] **Step 2: Add logging to connect()**

In the `connect()` method, replace the status/error handlers:

Replace `this.ws.onopen` callback (line 57-60):
```typescript
    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.emitStatus('WS open')
      log('STT', 'WebSocket connected')
    }
```

Replace `this.ws.onerror` callback (line 67-69):
```typescript
    this.ws.onerror = () => {
      this.emitStatus('WS error')
      log('ERR', 'STT WebSocket error')
      this.errorCallbacks.forEach(cb => cb(new Error('WebSocket error')))
    }
```

Replace `this.ws.onclose` callback (line 72-79):
```typescript
    this.ws.onclose = (e) => {
      this.emitStatus(`Closed:${e.code}`)
      log('STT', `WebSocket closed: ${e.code}`)
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
        this.reconnectAttempts++
        log('STT', `Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
        setTimeout(() => this.connect(), delay)
      }
    }
```

- [ ] **Step 3: Add logging to _handleMessage()**

In the `_handleMessage` method, add log calls after each status emit:

Replace the full `_handleMessage` method (lines 117-146):
```typescript
  _handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data)
      const type = msg.message_type ?? msg.type ?? ''

      if (type === 'session_started') {
        this.emitStatus('Session OK')
        log('STT', 'Session started')
        return
      }

      if (type === 'partial_transcript' && msg.text) {
        log('STT', `Partial transcript (len=${msg.text.length})`)
        this.partialCallbacks.forEach(cb => cb(msg.text))
        return
      }

      if ((type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') && msg.text) {
        log('STT', `Committed: "${msg.text.slice(0, 80)}" (len=${msg.text.length})`)
        this.committedCallbacks.forEach(cb => cb(msg.text))
        return
      }

      if (type === 'error') {
        const errMsg = msg.message ?? JSON.stringify(msg)
        this.emitStatus(`STT err: ${errMsg}`)
        log('ERR', `STT error: ${errMsg}`)
        return
      }

      this.emitStatus(`STT: ${type}`)
    } catch {
      this.emitStatus(`Parse err`)
      log('ERR', 'STT message parse error')
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/services/stt.ts
git commit -m "feat: add diagnostic logging to STT client"
```

---

### Task 3: Instrument listen module

**Files:**
- Modify: `src/glasses/listen.ts`

- [ ] **Step 1: Add import**

Add after existing imports (after line 3):
```typescript
import { log } from '../services/logger'
```

- [ ] **Step 2: Add logging to startListening()**

In `startListening()` (line 214+), add log calls at key points:

After session creation (after line 228, `appState.currentSessionId = session.id`):
```typescript
    log('SESSION', `Created id=${session.id}, ${appState.settings.listenLang}>${appState.settings.translateLang}`)
```

After `sttClient.connect()` (after line 285):
```typescript
    log('SESSION', 'Start listening')
```

In the `onCommittedTranscript` callback, inside the `for (const chunk of chunks)` loop:

After `committedPairs.push(...)` (after line 249):
```typescript
        log('STT', `Chunk queued for translation: "${chunk.slice(0, 60)}" ${sourceLang}>${targetLang}`)
```

Replace the paragraph save `catch {}` (inside `enqueueSave`, around line 261) with:
```typescript
              } catch (e) { log('ERR', `Paragraph save failed: ${e instanceof Error ? e.message : String(e)}`) }
```

After `const p = await api.appendParagraph(...)` (after line 259), add:
```typescript
                log('SAVE', `Paragraph saved id=${p.id}`)
```

In the translate `.then()` callback, add timing. Replace the translate call block (lines 269-279):
```typescript
        const translateStart = Date.now()
        api.translate(chunk, sourceLang, targetLang)
          .then(async (translated) => {
            if (translated) {
              log('TRANSLATE', `Response: "${translated.slice(0, 60)}" (${Date.now() - translateStart}ms)`)
              committedPairs[idx].translation = translated
              updateDisplay()
              const paraId = await savePromise
              if (paraId) api.updateParagraphTranslation(paraId, translated).catch((e) => { log('ERR', `Translation update failed: ${e instanceof Error ? e.message : String(e)}`) })
            }
          })
          .catch((e) => { log('ERR', `Translation failed: ${e instanceof Error ? e.message : String(e)}`) })
```

In the catch at end of `startListening()` (line 291-293), add logging:
```typescript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('ERR', `Start listening failed: ${msg}`)
    updateText(bridge, DISPLAY_ID, `Error: ${msg}\nDouble-click to go back.`)
  }
```

- [ ] **Step 3: Add logging to pause/resume**

In `pauseListening()` (line 119), add at start of function body:
```typescript
  log('SESSION', 'Paused')
```

In `resumeListening()` (line 129), add at start of function body:
```typescript
  log('SESSION', 'Resumed')
```

Replace the silent catches in `resumeListening()` the same way as in `startListening()` — add `log('ERR', ...)` to each `.catch(() => {})`.

- [ ] **Step 4: Add logging to fullStop()**

In `fullStop()` (line 196), add at start:
```typescript
  log('SESSION', 'Stopped')
```

- [ ] **Step 5: Commit**

```bash
git add src/glasses/listen.ts
git commit -m "feat: add diagnostic logging to listen module"
```

---

### Task 4: Instrument dialogue module

**Files:**
- Modify: `src/glasses/dialogue.ts`

- [ ] **Step 1: Add import**

After existing imports (after line 5):
```typescript
import { log } from '../services/logger'
```

- [ ] **Step 2: Add logging to startDialogue()**

After session creation (after line 219, `appState.currentSessionId = session.id`):
```typescript
    log('SESSION', `Dialogue created id=${session.id}`)
```

In the catch block (line 223-226), add:
```typescript
    log('ERR', `Start dialogue failed: ${msg}`)
```

- [ ] **Step 3: Add logging to generateAnswer()**

At start of `generateAnswer()` (after line 176):
```typescript
  log('DIALOGUE', `Request sent (messages=${conversationHistory.length})`)
  const dialogueStart = Date.now()
```

After successful response (after line 189, `lastAnswer = result`):
```typescript
    log('DIALOGUE', `Response received (${Date.now() - dialogueStart}ms)`)
```

In the catch block (line 202-206), add:
```typescript
    log('ERR', `Dialogue failed: ${msg}`)
```

Replace the `appendParagraph` catch (line 197):
```typescript
        .catch((e) => { log('ERR', `Dialogue paragraph save failed: ${e instanceof Error ? e.message : String(e)}`) })
```

- [ ] **Step 4: Add logging to committed transcript handler**

In the `onCommittedTranscript` callback inside `startAudio()`, add similar logging as listen.ts:

Replace the translate `.catch(() => {})` (line 165):
```typescript
        .catch((e) => { log('ERR', `Dialogue translation failed: ${e instanceof Error ? e.message : String(e)}`) })
```

Replace the paragraph save `catch {}` (inside enqueueSave, around line 152):
```typescript
              } catch (e) { log('ERR', `Dialogue paragraph save failed: ${e instanceof Error ? e.message : String(e)}`) }
```

After `const p = await api.appendParagraph(...)` (line 148), add:
```typescript
                log('SAVE', `Dialogue paragraph saved id=${p.id}`)
```

Replace `updateParagraphTranslation` silent catch (line 161):
```typescript
              if (paraId) api.updateParagraphTranslation(paraId, translated).catch((e) => { log('ERR', `Dialogue translation update failed: ${e instanceof Error ? e.message : String(e)}`) })
```

- [ ] **Step 5: Commit**

```bash
git add src/glasses/dialogue.ts
git commit -m "feat: add diagnostic logging to dialogue module"
```

---

### Task 5: Add log UI to phone settings

**Files:**
- Modify: `src/phone/index.html`
- Modify: `src/phone/settings.ts`

- [ ] **Step 1: Add HTML for log controls**

In `src/phone/index.html`, after the "Save Settings" button (after line 368), add:

```html

      <div style="text-align:center; margin-top:24px;">
        <a href="#" id="log-toggle" style="font-size:12px; color:#8e8e93; text-decoration:none; cursor:pointer;">Log file ›</a>
        <div id="log-controls" style="display:none; margin-top:12px; display:none;">
          <button class="btn btn-secondary btn-sm" id="log-download-btn" style="margin-right:8px;">Download log</button>
          <button class="btn btn-sm" id="log-clear-btn" style="color:#8e8e93; background:none; border:1px solid #d1d1d6;">Clear log</button>
        </div>
      </div>
```

- [ ] **Step 2: Wire up log controls in settings.ts**

In `src/phone/settings.ts`, add import at top:
```typescript
import { download, clear } from '../services/logger'
```

At the end of `initSettings()` function (before the closing `}`), add:

```typescript
  // Log file controls
  const logToggle = document.getElementById('log-toggle') as HTMLAnchorElement
  const logControls = document.getElementById('log-controls') as HTMLDivElement
  const logDownloadBtn = document.getElementById('log-download-btn') as HTMLButtonElement
  const logClearBtn = document.getElementById('log-clear-btn') as HTMLButtonElement

  logToggle.addEventListener('click', (e) => {
    e.preventDefault()
    const visible = logControls.style.display !== 'none'
    logControls.style.display = visible ? 'none' : 'block'
    logToggle.textContent = visible ? 'Log file ›' : 'Log file ‹'
  })

  logDownloadBtn.addEventListener('click', () => {
    if (!download()) {
      showToast('Log is empty')
    }
  })

  logClearBtn.addEventListener('click', () => {
    clear()
    showToast('Log cleared')
  })
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/pitcha/Yandex.Disk.localized/Cursor\ Projects/NoteWriter && npm run build` (or the project's build command)

- [ ] **Step 4: Commit**

```bash
git add src/phone/index.html src/phone/settings.ts
git commit -m "feat: add log download/clear UI to phone settings"
```

---

### Task 6: Manual test on device

- [ ] **Step 1: Deploy and test**

Deploy to device and verify:
1. Open Settings tab on phone
2. "Log file" link visible in muted text below Save Settings
3. Click it — Download/Clear buttons appear
4. Start a listen session, speak a few phrases
5. Go back to settings, download log
6. Verify log contains: SESSION Created, STT Connected, STT Committed, TRANSLATE Request/Response, SAVE entries
7. Click Clear, then Download — should show "Log is empty" toast
