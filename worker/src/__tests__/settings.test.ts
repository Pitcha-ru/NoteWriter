import { describe, it, expect, beforeEach } from 'vitest'
import { getSettings, updateSettings } from '../settings'

function createMockD1() {
  const settings: Map<string, { device_id: string; listen_lang: string; translate_lang: string }> = new Map()
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (query.includes('SELECT')) {
                const row = settings.get(args[0] as string)
                return row ? { listen_lang: row.listen_lang, translate_lang: row.translate_lang } : null
              }
              return null
            },
            async run() {
              if (query.includes('INSERT')) {
                settings.set(args[0] as string, {
                  device_id: args[0] as string,
                  listen_lang: 'en',
                  translate_lang: 'el',
                })
              }
              if (query.includes('UPDATE')) {
                const deviceId = args[4] as string
                settings.set(deviceId, {
                  device_id: deviceId,
                  listen_lang: args[0] as string,
                  translate_lang: args[1] as string,
                })
              }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

describe('settings', () => {
  let db: D1Database

  beforeEach(() => {
    db = createMockD1()
    // Simulate device registration creating default settings
    db.prepare('INSERT INTO settings (device_id) VALUES (?)').bind('device-1').run()
  })

  it('returns settings for device', async () => {
    const settings = await getSettings('device-1', db)
    expect(settings).toEqual({ listen_lang: 'en', translate_lang: 'el' })
    // context and persona may be present (from DB defaults) or absent in mock
  })

  it('returns null for unknown device', async () => {
    const settings = await getSettings('unknown', db)
    expect(settings).toBeNull()
  })

  it('updates settings', async () => {
    const result = await updateSettings('device-1', { listen_lang: 'fr', translate_lang: 'de', context: '', persona: '' }, db)
    expect(result.error).toBeUndefined()
    const settings = await getSettings('device-1', db)
    expect(settings!.listen_lang).toBe('fr')
    expect(settings!.translate_lang).toBe('de')
  })

  it('rejects invalid language', async () => {
    const result = await updateSettings('device-1', { listen_lang: 'xx', translate_lang: 'de', context: '', persona: '' }, db)
    expect(result.error).toContain('Invalid language')
  })

  it('rejects same source and target', async () => {
    const result = await updateSettings('device-1', { listen_lang: 'en', translate_lang: 'en', context: '', persona: '' }, db)
    expect(result.error).toContain('must differ')
  })
})
