import { DialogueRequest } from './types'

const LANG_NAMES: Record<string, string> = {
  en: 'English', el: 'Greek', fr: 'French', de: 'German', ru: 'Russian',
}

export function buildOpenAIMessages(
  messages: DialogueRequest['messages'],
  context: string,
  persona: string,
  targetLangName: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const systemPrompt = `You are a dialogue assistant. You help the user respond in conversations.

Context: ${context || 'General conversation'}
Persona: ${persona || 'A friendly person'}

Rules:
- Generate a response as if you ARE the persona
- Respond in the SAME language as the last question/statement
- Keep responses short (1-3 sentences), appropriate for spoken dialogue
- If the persona description doesn't cover the topic, improvise naturally within the given context
- After the response, add a translation to ${targetLangName}

Format your response EXACTLY as:
RESPONSE: [your response in the original language]
TRANSLATION: [translation to ${targetLangName}]`

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
  const responseMatch = text.match(/RESPONSE:\s*(.+?)(?:\nTRANSLATION:|$)/s)
  const translationMatch = text.match(/TRANSLATION:\s*(.+?)$/s)
  if (responseMatch) {
    return {
      response: responseMatch[1].trim(),
      translation: translationMatch ? translationMatch[1].trim() : '',
    }
  }
  return { response: text.trim(), translation: '' }
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
      model: 'gpt-4.1-nano',
      messages,
      stream: true,
      max_tokens: 200,
      temperature: 0.7,
    }),
  })
}
