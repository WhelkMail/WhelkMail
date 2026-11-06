export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const base = new Headers(headers)
  base.set('Content-Type', 'application/json; charset=utf-8')
  base.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(data), { status, headers: base })
}

export function fail(
  message: string,
  status = 400,
  detail?: string,
  code?: string,
  headers?: HeadersInit,
): Response {
  return json(
    {
      error: message,
      ...(detail ? { detail } : {}),
      ...(code ? { code } : {}),
    },
    status,
    headers,
  )
}

export function failCode(code: string, status = 400, detail?: string, message?: string): Response {
  return fail(message ?? code, status, detail, code)
}

export const MAX_JSON_BYTES = 32 * 1024 * 1024

export async function readJson<T>(request: Request): Promise<T> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
    throw new HttpError(413, 'Payload too large')
  }
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
}

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  return url.origin
}

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}
