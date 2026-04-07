import { AwsClient } from 'aws4fetch'

export const LANG_CODES: Record<string, string> = { en: 'en', el: 'el', fr: 'fr', de: 'de' }

export function buildTranslateRequest(text: string, sourceLang: string, targetLang: string) {
  if (sourceLang === targetLang) throw new Error('Source and target language must differ')
  return { SourceLanguageCode: LANG_CODES[sourceLang] ?? sourceLang, TargetLanguageCode: LANG_CODES[targetLang] ?? targetLang, Text: text }
}

export function parseTranslateResponse(response: { TranslatedText: string }): string {
  return response.TranslatedText
}

export async function translateText(text: string, sourceLang: string, targetLang: string, awsAccessKeyId: string, awsSecretAccessKey: string, awsRegion: string): Promise<string> {
  // retries: 0 — the caller (index.ts) handles errors and retrying inside a
  // Worker would waste CPU time and delay the response.
  const client = new AwsClient({ accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey, region: awsRegion, service: 'translate', retries: 0 })
  const body = buildTranslateRequest(text, sourceLang, targetLang)
  const response = await client.fetch(`https://translate.${awsRegion}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSShineFrontendService_20170701.TranslateText' },
    body: JSON.stringify(body),
  })
  if (!response.ok) { const err = await response.text(); throw new Error(`Amazon Translate error (${response.status}): ${err}`) }
  const result = await response.json<{ TranslatedText: string }>()
  return parseTranslateResponse(result)
}
