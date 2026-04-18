const STORAGE_KEY = 'notewriter:log'
const entries: string[] = []

function pad(n: number, len = 2): string { return String(n).padStart(len, '0') }

function timestamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

// Load existing entries from localStorage on module init
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) entries.push(...parsed)
  }
} catch {}

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch {}
}

export function log(tag: string, message: string): void {
  const entry = `[${timestamp()}] [${tag}] ${message}`
  entries.push(entry)
  persist()
}

export function download(): boolean {
  if (entries.length === 0) return false
  const text = entries.join('\n') + '\n'
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  a.href = url
  a.download = `notewriter-log-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return true
}

export function clear(): void {
  entries.length = 0
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

export async function copyToClipboard(): Promise<boolean> {
  if (entries.length === 0) return false
  const text = entries.join('\n') + '\n'
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function getEntries(): string[] {
  return entries
}
