import { encrypt, decrypt } from './crypto'
import { KeysPayload, MaskedKeys } from './types'

const KV_PREFIX = 'keys:'

export async function saveKeys(deviceId: string, keys: KeysPayload, kv: KVNamespace, masterKey: string): Promise<void> {
  const encrypted = await encrypt(JSON.stringify(keys), masterKey)
  await kv.put(`${KV_PREFIX}${deviceId}`, encrypted)
}

export async function getKeys(deviceId: string, kv: KVNamespace, masterKey: string): Promise<KeysPayload | null> {
  const encrypted = await kv.get(`${KV_PREFIX}${deviceId}`)
  if (!encrypted) return null
  const decrypted = await decrypt(encrypted, masterKey)
  return JSON.parse(decrypted)
}

export async function getMaskedKeys(deviceId: string, kv: KVNamespace, masterKey: string): Promise<MaskedKeys | null> {
  const keys = await getKeys(deviceId, kv, masterKey)
  if (!keys) return null
  return {
    elevenlabs_key: mask(keys.elevenlabs_key),
    aws_access_key_id: mask(keys.aws_access_key_id),
    aws_secret_access_key: mask(keys.aws_secret_access_key),
    aws_region: keys.aws_region,
    openai_key: mask(keys.openai_key),
  }
}

export async function deleteKeys(deviceId: string, kv: KVNamespace): Promise<void> {
  await kv.delete(`${KV_PREFIX}${deviceId}`)
}

function mask(value: string): string {
  if (value.length <= 3) return '****'
  return '****' + value.slice(-3)
}

// In-memory cache for decrypted keys (TTL: 5 minutes).
// CAVEAT: Cloudflare Workers isolates can be evicted at any time (e.g. after
// periods of low traffic or during platform maintenance). Each new isolate
// starts with an empty cache, so this optimisation is best-effort and may
// provide zero benefit under low traffic conditions. Do not rely on it for
// correctness — it is purely a performance hint to avoid redundant KV reads
// during the lifetime of a single isolate.
interface CacheEntry { keys: KeysPayload; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getCachedKeys(deviceId: string, kv: KVNamespace, masterKey: string): Promise<KeysPayload | null> {
  const cached = cache.get(deviceId)
  if (cached && cached.expiresAt > Date.now()) return cached.keys
  const keys = await getKeys(deviceId, kv, masterKey)
  if (keys) cache.set(deviceId, { keys, expiresAt: Date.now() + CACHE_TTL_MS })
  return keys
}
