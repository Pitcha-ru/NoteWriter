import { Env, SettingsPayload } from './types'
import { handleRegister, authenticate } from './auth'
import { saveKeys, getMaskedKeys, deleteKeys, getCachedKeys } from './keys'
import { translateText } from './translate'
import { getSettings, updateSettings } from './settings'
import { createSession, listSessions, getSession, appendParagraph, deleteSession } from './sessions'

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

    const response = await handleRequest(request, env, path, url)
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  },
} satisfies ExportedHandler<Env>

async function handleRequest(request: Request, env: Env, path: string, url: URL): Promise<Response> {
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

  // Keys routes
  if (path === '/api/keys') {
    if (request.method === 'GET') {
      const masked = await getMaskedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
      return json(masked ?? { elevenlabs_key: null, aws_access_key_id: null, aws_secret_access_key: null, aws_region: null })
    }
    if (request.method === 'PUT') {
      const body = await request.json<{ elevenlabs_key: string; aws_access_key_id: string; aws_secret_access_key: string; aws_region: string }>()
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

  // Translate route
  if (path === '/api/translate' && request.method === 'POST') {
    const body = await request.json<{ text: string; source_lang: string; target_lang: string }>()
    if (!body.text || !body.source_lang || !body.target_lang) {
      return json({ error: 'text, source_lang, and target_lang required' }, 400)
    }
    const keys = await getCachedKeys(deviceId, env.KV, env.ENCRYPTION_KEY)
    if (!keys) return json({ error: 'API keys not configured' }, 400)
    try {
      const translated = await translateText(body.text, body.source_lang, body.target_lang, keys.aws_access_key_id, keys.aws_secret_access_key, keys.aws_region)
      return json({ translated_text: translated })
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'Translation failed' }, 502)
    }
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

  return json({ error: 'Not found' }, 404)
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
