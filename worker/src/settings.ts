import { SettingsPayload } from './types'

const VALID_LANGS = ['auto', 'en', 'el', 'fr', 'de', 'ru']

export async function getSettings(deviceId: string, db: D1Database): Promise<SettingsPayload | null> {
  const row = await db.prepare('SELECT listen_lang, translate_lang, context, persona, translate_provider, translate_model FROM settings WHERE device_id = ?')
    .bind(deviceId)
    .first<{ listen_lang: string; translate_lang: string; context: string; persona: string; translate_provider: string | null; translate_model: string | null }>()
  if (!row) return null
  return { ...row, translate_provider: row.translate_provider ?? 'openai', translate_model: row.translate_model ?? 'gpt-4o-mini' }
}

export async function updateSettings(deviceId: string, settings: SettingsPayload, db: D1Database): Promise<{ error?: string }> {
  if (!VALID_LANGS.includes(settings.listen_lang) || !VALID_LANGS.includes(settings.translate_lang)) {
    return { error: 'Invalid language. Supported: en, el, fr, de, ru' }
  }
  if (settings.listen_lang !== 'auto' && settings.listen_lang === settings.translate_lang) {
    return { error: 'Source and target language must differ' }
  }
  await db.prepare('UPDATE settings SET listen_lang = ?, translate_lang = ?, context = ?, persona = ?, translate_provider = ?, translate_model = ? WHERE device_id = ?')
    .bind(settings.listen_lang, settings.translate_lang, settings.context, settings.persona, settings.translate_provider ?? 'amazon', settings.translate_model ?? 'gpt-4o-mini', deviceId)
    .run()
  return {}
}
