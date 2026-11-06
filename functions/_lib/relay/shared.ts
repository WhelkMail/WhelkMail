export function formatAddress(name: string, email: string): string {
  const clean = name.replace(/[\r\n"\\]+/g, ' ').trim()
  return clean ? `"${clean}" <${email}>` : email
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function errorDetail(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data) {
    return data
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    for (const key of ['message', 'error', 'detail', 'Message']) {
      const value = record[key]
      if (typeof value === 'string' && value) {
        return value
      }
    }
  }
  return fallback
}
