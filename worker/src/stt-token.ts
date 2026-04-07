export function buildTokenRequest(apiKey: string, apiBase: string): { url: string; options: { method: string; headers: Record<string, string> } } {
  return {
    url: `${apiBase}/v1/single-use-token/realtime_scribe`,
    options: { method: 'POST', headers: { 'xi-api-key': apiKey } },
  }
}

export async function mintSttToken(apiKey: string, apiBase: string): Promise<{ token: string } | { error: string }> {
  const { url, options } = buildTokenRequest(apiKey, apiBase)
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.text()
    return { error: `ElevenLabs token error (${response.status}): ${body}` }
  }
  const data = await response.json<{ token: string }>()
  return { token: data.token }
}
