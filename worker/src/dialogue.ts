import { DialogueRequest } from './types'

const LANG_NAMES: Record<string, string> = {
  en: 'English', el: 'Greek', fr: 'French', de: 'German', ru: 'Russian',
}

export function buildOpenAIMessages(
  messages: DialogueRequest['messages'],
  context: string,
  persona: string,
  sourceLangName: string,
  targetLangName: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const systemPrompt = `You are generating spoken dialogue responses.

The conversation is in ${sourceLangName}. You MUST write the response in correct, natural, grammatically proper ${sourceLangName}.

About the person you are speaking as:
${persona || 'A friendly person.'}

Situation:
${context || 'General conversation.'}

CRITICAL RULES:
1. Write the response ONLY in ${sourceLangName}. It must be fluent and grammatically correct ${sourceLangName}, as a native speaker would say it.
2. Keep it short: 1-3 sentences, suitable for spoken dialogue.
3. If the persona info doesn't cover the question, make up a plausible answer fitting the context.
4. After a blank line, write the ${targetLangName} translation.

Output format (no labels, no "RESPONSE:", no "TRANSLATION:"):
[Your response in ${sourceLangName}]

[Translation in ${targetLangName}]`

  const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]
  const recent = messages.slice(-15)
  for (const msg of recent) {
    openaiMessages.push({ role: msg.role === 'other' ? 'user' : 'assistant', content: msg.text })
  }
  return openaiMessages
}

export function parseDialogueResponse(text: string): { response: string; translation: string } {
  const t = text.trim()

  // Try RESPONSE:/TRANSLATION: markers first
  const markerMatch = t.match(/^RESPONSE:?\s*([\s\S]*?)\nTRANSLATION:?\s*([\s\S]*)$/i)
  if (markerMatch) {
    return { response: markerMatch[1].trim(), translation: markerMatch[2].trim() }
  }

  // Split on blank line (double newline)
  const parts = t.split(/\n\s*\n/)
  if (parts.length >= 2) {
    const response = parts[0].replace(/^RESPONSE:?\s*/i, '').trim()
    const translation = parts.slice(1).join('\n').replace(/^TRANSLATION:?\s*/i, '').trim()
    return { response, translation }
  }

  // No separation found — strip any markers and return as response only
  return { response: t.replace(/^RESPONSE:?\s*/i, '').trim(), translation: '' }
}

export async function streamDialogueResponse(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  openaiKey: string
): Promise<Response> {
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      stream: true,
      max_tokens: 200,
      temperature: 0.7,
    }),
  })
}
