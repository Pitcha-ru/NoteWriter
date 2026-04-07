import { Env } from './types'
import { handleRegister, authenticate } from './auth'
import { saveKeys, getMaskedKeys, deleteKeys } from './keys'

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

  return json({ error: 'Not found' }, 404)
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
