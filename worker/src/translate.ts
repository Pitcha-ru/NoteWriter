import { AwsClient } from 'aws4fetch'

export const LANG_CODES: Record<string, string> = { en: 'en', el: 'el', fr: 'fr', de: 'de', ru: 'ru' }
const LANG_NAMES: Record<string, string> = { en: 'English', el: 'Greek', fr: 'French', de: 'German', ru: 'Russian' }

export function buildTranslateRequest(text: string, sourceLang: string, targetLang: string) {
  if (sourceLang !== 'auto' && sourceLang === targetLang) throw new Error('Source and target language must differ')
  return { SourceLanguageCode: sourceLang === 'auto' ? 'auto' : (LANG_CODES[sourceLang] ?? sourceLang), TargetLanguageCode: LANG_CODES[targetLang] ?? targetLang, Text: text }
}

export function parseTranslateResponse(response: { TranslatedText: string }): string {
  return response.TranslatedText
}

export async function translateText(text: string, sourceLang: string, targetLang: string, awsAccessKeyId: string, awsSecretAccessKey: string, awsRegion: string): Promise<string> {
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

export async function translateWithOpenAI(text: string, sourceLang: string, targetLang: string, openaiKey: string, model: string): Promise<string> {
  const targetName = LANG_NAMES[targetLang] ?? targetLang
  const sourceName = sourceLang === 'auto' ? 'the source language' : (LANG_NAMES[sourceLang] ?? sourceLang)
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `You are a translator. Translate the following text from ${sourceName} to ${targetName}. Output ONLY the translation, nothing else.` },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  })
  if (!response.ok) { const err = await response.text(); throw new Error(`OpenAI Translate error (${response.status}): ${err.slice(0, 200)}`) }
  const result = await response.json<{ choices: Array<{ message: { content: string } }> }>()
  return result.choices[0]?.message?.content?.trim() ?? ''
}
