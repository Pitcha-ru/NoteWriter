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
      elevenlabs_key: 'key', aws_access_key_id: 'key',
      aws_secret_access_key: 'key', aws_region: 'eu-west-1',
    }, kv, masterKey)
    await deleteKeys('device-1', kv)
    const result = await getKeys('device-1', kv, masterKey)
    expect(result).toBeNull()
  })
})
