import { describe, it, expect, beforeEach } from 'vitest'
import { handleRegister, authenticate } from '../auth'

function createMockD1() {
  const devices: Map<string, { id: string; token_hash: string }> = new Map()
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (query.includes('SELECT')) {
                if (query.includes('token_hash = ?')) {
                  // authenticate: look up by token_hash
                  for (const device of devices.values()) {
                    if (device.token_hash === args[0]) {
                      return { id: device.id }
                    }
                  }
                  return null
                }
                // handleRegister: look up by id
                return devices.get(args[0] as string) ?? null
              }
              return null
            },
            async run() {
              if (query.includes('INSERT INTO devices')) {
                devices.set(args[0] as string, {
                  id: args[0] as string,
                  token_hash: args[1] as string,
                })
              }
              // INSERT INTO settings is a no-op in the mock
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
