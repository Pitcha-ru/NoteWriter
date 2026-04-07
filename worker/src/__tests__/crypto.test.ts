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

    it('produces different ciphertext for same input (random IV and salt)', async () => {
      const plaintext = 'same input'
      const a = await encrypt(plaintext, masterKey)
      const b = await encrypt(plaintext, masterKey)
      expect(a).not.toBe(b)
    })

    it('uses a unique salt per encryption (first 16 bytes differ)', async () => {
      const plaintext = 'salt test'
      const a = Uint8Array.from(atob(await encrypt(plaintext, masterKey)), c => c.charCodeAt(0))
      const b = Uint8Array.from(atob(await encrypt(plaintext, masterKey)), c => c.charCodeAt(0))
      // salts (first 16 bytes) should differ
      expect(Array.from(a.slice(0, 16))).not.toEqual(Array.from(b.slice(0, 16)))
    })

    it('wrong key fails to decrypt', async () => {
      const encrypted = await encrypt('secret', masterKey)
      await expect(decrypt(encrypted, 'wrong-key')).rejects.toThrow()
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
