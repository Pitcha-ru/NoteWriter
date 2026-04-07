import { SettingsPayload } from './types'

const VALID_LANGS = ['en', 'el', 'fr', 'de', 'ru']

export async function getSettings(deviceId: string, db: D1Database): Promise<SettingsPayload | null> {
  return db.prepare('SELECT listen_lang, translate_lang FROM settings WHERE device_id = ?')
    .bind(deviceId)
    .first<{ listen_lang: string; translate_lang: string }>()
}

export async function updateSettings(deviceId: string, settings: SettingsPayload, db: D1Database): Promise<{ error?: string }> {
  if (!VALID_LANGS.includes(settings.listen_lang) || !VALID_LANGS.includes(settings.translate_lang)) {
    return { error: 'Invalid language. Supported: en, el, fr, de, ru' }
  }
  if (settings.listen_lang === settings.translate_lang) {
    return { error: 'Source and target language must differ' }
  }
  await db.prepare('UPDATE settings SET listen_lang = ?, translate_lang = ? WHERE device_id = ?')
    .bind(settings.listen_lang, settings.translate_lang, deviceId)
    .run()
  return {}
}
