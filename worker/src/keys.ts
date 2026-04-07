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
    aws_secret_access_key: null,
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
