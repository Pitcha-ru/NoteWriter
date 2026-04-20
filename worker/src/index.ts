import { Env, SettingsPayload, DialogueRequest } from './types'
import { handleRegister, authenticate } from './auth'
import { getKeys, saveKeys, getMaskedKeys, deleteKeys, getCachedKeys } from './keys'
import { mintSttToken } from './stt-token'
import { translateText, translateWithOpenAI } from './translate'
import { getSettings, updateSettings } from './settings'
import { createSession, listSessions, getSession, appendParagraph, updateParagraphTranslation, deleteSession } from './sessions'
import { buildOpenAIMessages, streamDialogueResponse } from './dialogue'
import { listNotes, getNote, createNote, updateNote, deleteNote } from './notes'
import { handleAdminRequest } from './admin'
import { writeLog, getLogs } from './device-log'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          // Wildcard is safe here: this worker is called from a WebView (not a
          // browser tab), so there is no cookie-based credential to hijack via
          // CSRF. Bearer tokens are attached explicitly by client code and are
          // not automatically sent by the browser's fetch, making the wildcard
          // CORS policy non-exploitable in this context.
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    // Admin routes (have their own auth)
    if (path.startsWith('/admin')) {
      const adminResponse = await handleAdminRequest(request, env, path)
      if (adminResponse) {
        adminResponse.headers.set('Access-Control-Allow-Origin', '*')
        return adminResponse
      }
    }

    const response = await handleRequest(request, env, ctx, path, url)
    // See comment above — wildcard is acceptable for this WebView-only API.
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  },
} satisfies ExportedHandler<Env>

const VALID_LANGS = new Set(['auto', 'en', 'el', 'fr', 'de', 'ru'])

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext, path: string, url: URL): Promise<Response> {
  // Fix 7: Fail fast if ENCRYPTION_KEY is not configured.
  if (!env.ENCRYPTION_KEY) {
    return json({ error: 'Server configuration error' }, 500)
  }

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
    // Log after registration (device_id is the identifier here, not a token-auth'd deviceId)
    ctx.waitUntil(writeLog(body.device_id, { event: 'register', data: { ok: true }, status: 201 }, env.DB))
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

  // Server logs route
  if (path === '/api/logs' && request.method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200'), 500)
    const logs = await getLogs(deviceId, limit, env.DB)
    return json(logs)
  }

  // Keys routes
  if (path === '/api/keys') {
    if (request.method === 'GET') {
      const masked = await getMaskedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
      return json(masked ?? { elevenlabs_key: null, aws_access_key_id: null, aws_secret_access_key: null, aws_region: null })
    }
    if (request.method === 'PUT') {
      const body = await request.json<Record<string, string>>()
      // Merge with existing keys — only overwrite fields that are non-empty
      const existing = await getKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
      const merged = {
        elevenlabs_key: body.elevenlabs_key || existing?.elevenlabs_key || '',
        aws_access_key_id: body.aws_access_key_id || existing?.aws_access_key_id || '',
        aws_secret_access_key: body.aws_secret_access_key || existing?.aws_secret_access_key || '',
        aws_region: body.aws_region || existing?.aws_region || '',
        openai_key: body.openai_key || existing?.openai_key || '',
      }
      await saveKeys(deviceId, merged, env.KV, env.ENCRYPTION_KEY)
      const saved: string[] = []
      if (body.elevenlabs_key) saved.push('elevenlabs')
      if (body.aws_access_key_id) saved.push('aws_access')
      if (body.aws_secret_access_key) saved.push('aws_secret')
      if (body.aws_region) saved.push('aws_region')
      if (body.openai_key) saved.push('openai')
      ctx.waitUntil(writeLog(deviceId, { event: 'keys_save', data: { fields: saved }, status: 200 }, env.DB))
      return json({ ok: true })
    }
    if (request.method === 'DELETE') {
      await deleteKeys(deviceId, env.KV)
      ctx.waitUntil(writeLog(deviceId, { event: 'keys_delete', status: 200 }, env.DB))
      return json({ ok: true })
    }
  }

  // Settings routes
  if (path === '/api/settings') {
    if (request.method === 'GET') {
      const settings = await getSettings(deviceId, env.DB)
      const s = settings ?? { listen_lang: 'en', translate_lang: 'el', context: '', persona: '', translate_provider: 'openai', translate_model: 'gpt-4o-mini' }
      return json({ listen_lang: s.listen_lang, translate_lang: s.translate_lang, context: s.context, persona: s.persona, translate_provider: s.translate_provider, translate_model: s.translate_model, listenLang: s.listen_lang, translateLang: s.translate_lang, translateProvider: s.translate_provider, translateModel: s.translate_model })
    }
    if (request.method === 'PUT') {
      const raw = await request.json<any>()
      // Accept both camelCase (listenLang) and snake_case (listen_lang)
      // Merge with existing settings to avoid overwriting fields not included in request
      const existing = await getSettings(deviceId, env.DB)
      const body: SettingsPayload = {
        listen_lang: raw.listen_lang ?? raw.listenLang ?? existing?.listen_lang ?? 'en',
        translate_lang: raw.translate_lang ?? raw.translateLang ?? existing?.translate_lang ?? 'el',
        context: raw.context ?? existing?.context ?? '',
        persona: raw.persona ?? existing?.persona ?? '',
        translate_provider: raw.translate_provider ?? raw.translateProvider ?? existing?.translate_provider ?? 'amazon',
        translate_model: raw.translate_model ?? raw.translateModel ?? existing?.translate_model ?? 'gpt-4o-mini',
      }
      const result = await updateSettings(deviceId, body, env.DB)
      if (result.error) return json({ error: result.error }, 400)
      ctx.waitUntil(writeLog(deviceId, { event: 'settings_save', data: { listen_lang: body.listen_lang, translate_lang: body.translate_lang, translate_provider: body.translate_provider, translate_model: body.translate_model }, status: 200 }, env.DB))
      return json({ ok: true })
    }
  }

  // STT token route
  if (path === '/api/stt-token' && request.method === 'POST') {
    const t0 = Date.now()
    const keys = await getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
    if (!keys?.elevenlabs_key) {
      ctx.waitUntil(writeLog(deviceId, { event: 'stt_token', data: { error: 'key_not_configured' }, status: 400 }, env.DB))
      return json({ error: 'ElevenLabs key not configured' }, 400)
    }
    const result = await mintSttToken(keys.elevenlabs_key, env.ELEVENLABS_API_BASE)
    if ('error' in result) {
      ctx.waitUntil(writeLog(deviceId, { event: 'stt_token', data: { error: result.error }, duration_ms: Date.now() - t0, status: 502 }, env.DB))
      return json({ error: result.error }, 502)
    }
    ctx.waitUntil(writeLog(deviceId, { event: 'stt_token', data: { ok: true }, duration_ms: Date.now() - t0, status: 200 }, env.DB))
    return json({ token: result.token })
  }

  // Translate route
  if (path === '/api/translate' && request.method === 'POST') {
    const body = await request.json<{ text: string; source_lang: string; target_lang: string; provider?: string; model?: string }>()
    if (!body.text || !body.source_lang || !body.target_lang) {
      return json({ error: 'text, source_lang, and target_lang required' }, 400)
    }
    if (body.text.length > 5000) {
      return json({ error: 'Text too long (max 5000 chars)' }, 400)
    }
    const keys = await getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
    if (!keys) return json({ error: 'API keys not configured' }, 400)
    const t0 = Date.now()
    const logData: Record<string, unknown> = {
      provider: body.provider ?? 'amazon',
      model: body.model ?? null,
      source_lang: body.source_lang,
      target_lang: body.target_lang,
      text_len: body.text.length,
    }
    try {
      let translated: string
      if (body.provider === 'openai') {
        if (!keys.openai_key) return json({ error: 'OpenAI key not configured' }, 400)
        translated = await translateWithOpenAI(body.text, body.source_lang, body.target_lang, keys.openai_key, body.model || 'gpt-4o-mini')
      } else {
        translated = await translateText(body.text, body.source_lang, body.target_lang, keys.aws_access_key_id, keys.aws_secret_access_key, keys.aws_region)
      }
      ctx.waitUntil(writeLog(deviceId, { event: 'translate', data: logData, duration_ms: Date.now() - t0, status: 200 }, env.DB))
      return json({ translated_text: translated })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Translation failed'
      ctx.waitUntil(writeLog(deviceId, { event: 'translate', data: { ...logData, error: errMsg }, duration_ms: Date.now() - t0, status: 502 }, env.DB))
      return json({ error: errMsg }, 502)
    }
  }

  // Dialogue route
  if (path === '/api/dialogue/generate' && request.method === 'POST') {
    const body = await request.json<DialogueRequest>()
    if (!body.messages?.length) return json({ error: 'messages required' }, 400)
    const keys = await getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
    if (!keys?.openai_key) return json({ error: 'OpenAI key not configured' }, 400)
    const langNames: Record<string, string> = { en: 'English', el: 'Greek', fr: 'French', de: 'German', ru: 'Russian', auto: 'the same language as the question' }
    const sourceLangName = langNames[body.source_lang] ?? body.source_lang
    const targetLangName = langNames[body.target_lang] ?? body.target_lang
    const openaiMessages = buildOpenAIMessages(body.messages, body.context, body.persona, sourceLangName, targetLangName)
    const t0 = Date.now()
    try {
      const streamResponse = await streamDialogueResponse(openaiMessages, keys.openai_key)
      if (!streamResponse.ok) {
        const err = await streamResponse.text()
        ctx.waitUntil(writeLog(deviceId, { event: 'dialogue', data: { error: `openai_${streamResponse.status}`, msg_count: body.messages.length }, duration_ms: Date.now() - t0, status: 502 }, env.DB))
        return json({ error: `OpenAI error (${streamResponse.status}): ${err.slice(0, 200)}` }, 502)
      }
      ctx.waitUntil(writeLog(deviceId, { event: 'dialogue', data: { msg_count: body.messages.length, source_lang: body.source_lang, target_lang: body.target_lang }, duration_ms: Date.now() - t0, status: 200 }, env.DB))
      return new Response(streamResponse.body, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' },
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Generation failed'
      ctx.waitUntil(writeLog(deviceId, { event: 'dialogue', data: { error: errMsg }, duration_ms: Date.now() - t0, status: 502 }, env.DB))
      return json({ error: errMsg }, 502)
    }
  }

  // Hide group note route
  const hideMatch = path.match(/^\/api\/notes\/([^/]+)\/hide$/)
  if (hideMatch && request.method === 'POST') {
    const noteId = hideMatch[1]
    await env.DB.prepare('INSERT OR IGNORE INTO hidden_group_notes (device_id, note_id) VALUES (?, ?)').bind(deviceId, noteId).run()
    return json({ ok: true })
  }

  // Notes routes
  const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/)

  if (path === '/api/notes') {
    if (request.method === 'GET') {
      const notes = await listNotes(deviceId, env.DB)
      return json(notes)
    }
    if (request.method === 'POST') {
      const body = await request.json<{ title?: string; content?: string }>()
      const note = await createNote(deviceId, body.title ?? '', body.content ?? '', env.DB)
      return json(note, 201)
    }
  }

  if (noteMatch) {
    const noteId = noteMatch[1]
    if (request.method === 'GET') {
      const note = await getNote(noteId, deviceId, env.DB)
      if (!note) return json({ error: 'Note not found' }, 404)
      return json(note)
    }
    if (request.method === 'PUT') {
      const body = await request.json<{ title?: string; content?: string }>()
      const updated = await updateNote(noteId, deviceId, body.title ?? '', body.content ?? '', env.DB)
      if (!updated) return json({ error: 'Note not found' }, 404)
      return json({ ok: true })
    }
    if (request.method === 'DELETE') {
      const deleted = await deleteNote(noteId, deviceId, env.DB)
      if (!deleted) return json({ error: 'Note not found' }, 404)
      return json({ ok: true })
    }
  }

  // Paragraph translation update
  const paragraphMatch = path.match(/^\/api\/paragraphs\/([^/]+)$/)
  if (paragraphMatch && request.method === 'PUT') {
    const paraId = paragraphMatch[1]
    const body = await request.json<{ translation: string }>()
    if (!body.translation) return json({ error: 'translation required' }, 400)
    await updateParagraphTranslation(paraId, body.translation, env.DB)
    return json({ ok: true })
  }

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
      const body = await request.json<{ listen_lang: string; translate_lang: string; mode?: string }>()
      if (!body.listen_lang || !body.translate_lang) {
        return json({ error: 'listen_lang and translate_lang required' }, 400)
      }
      if (!VALID_LANGS.has(body.listen_lang) || !VALID_LANGS.has(body.translate_lang)) {
        return json({ error: 'Invalid language. Allowed: en, el, fr, de, ru' }, 400)
      }
      const session = await createSession(deviceId, body.listen_lang, body.translate_lang, env.DB, body.mode ?? 'listen')
      ctx.waitUntil(writeLog(deviceId, { event: 'session_create', data: { session_id: session.id, listen_lang: body.listen_lang, translate_lang: body.translate_lang, mode: body.mode ?? 'listen' }, status: 201 }, env.DB))
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
      if (!body.original) {
        return json({ error: 'original text is required' }, 400)
      }
      const t0 = Date.now()
      try {
        const paragraph = await appendParagraph(sessionId, deviceId, body.original, body.translation, env.DB)
        if (!paragraph) return json({ error: 'Session not found' }, 404)
        ctx.waitUntil(writeLog(deviceId, { event: 'session_append', data: { session_id: sessionId, text_len: body.original.length, has_translation: !!body.translation }, duration_ms: Date.now() - t0, status: 201 }, env.DB))
        return json(paragraph, 201)
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return json({ error: 'Conflict: duplicate paragraph position' }, 409)
        }
        throw err
      }
    }
    if (request.method === 'DELETE') {
      const deleted = await deleteSession(sessionId, deviceId, env.DB)
      if (!deleted) return json({ error: 'Session not found' }, 404)
      ctx.waitUntil(writeLog(deviceId, { event: 'session_delete', data: { session_id: sessionId }, status: 200 }, env.DB))
      return json({ ok: true })
    }
  }

  return json({ error: 'Not found' }, 404)
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
