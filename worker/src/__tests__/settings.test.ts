import { describe, it, expect, beforeEach } from 'vitest'
import { getSettings, updateSettings } from '../settings'

function createMockD1() {
  const settings: Map<string, { device_id: string; listen_lang: string; translate_lang: string; context: string; persona: string; translate_provider: string; translate_model: string }> = new Map()
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (query.includes('SELECT')) {
                const row = settings.get(args[0] as string)
                return row ? { listen_lang: row.listen_lang, translate_lang: row.translate_lang, context: row.context, persona: row.persona, translate_provider: row.translate_provider, translate_model: row.translate_model } : null
              }
              return null
            },
            async run() {
              if (query.includes('INSERT')) {
                settings.set(args[0] as string, {
                  device_id: args[0] as string,
                  listen_lang: 'en',
                  translate_lang: 'el',
                  context: '',
                  persona: '',
                  translate_provider: 'openai',
                  translate_model: 'gpt-4o-mini',
                })
              }
              if (query.includes('UPDATE')) {
                const deviceId = args[6] as string
                settings.set(deviceId, {
                  device_id: deviceId,
                  listen_lang: args[0] as string,
                  translate_lang: args[1] as string,
                  context: args[2] as string,
                  persona: args[3] as string,
                  translate_provider: args[4] as string,
                  translate_model: args[5] as string,
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
    expect(settings).toEqual({ listen_lang: 'en', translate_lang: 'el', context: '', persona: '', translate_provider: 'openai', translate_model: 'gpt-4o-mini' })
  })

  it('returns null for unknown device', async () => {
    const settings = await getSettings('unknown', db)
    expect(settings).toBeNull()
  })

  it('updates settings', async () => {
    const result = await updateSettings('device-1', { listen_lang: 'fr', translate_lang: 'de', context: '', persona: '', translate_provider: 'openai', translate_model: 'gpt-4o' }, db)
    expect(result.error).toBeUndefined()
    const settings = await getSettings('device-1', db)
    expect(settings!.listen_lang).toBe('fr')
    expect(settings!.translate_lang).toBe('de')
    expect(settings!.translate_provider).toBe('openai')
    expect(settings!.translate_model).toBe('gpt-4o')
  })

  it('rejects invalid language', async () => {
    const result = await updateSettings('device-1', { listen_lang: 'xx', translate_lang: 'de', context: '', persona: '', translate_provider: 'amazon', translate_model: 'gpt-4o-mini' }, db)
    expect(result.error).toContain('Invalid language')
  })

  it('rejects same source and target', async () => {
    const result = await updateSettings('device-1', { listen_lang: 'en', translate_lang: 'en', context: '', persona: '', translate_provider: 'amazon', translate_model: 'gpt-4o-mini' }, db)
    expect(result.error).toContain('must differ')
  })
})
