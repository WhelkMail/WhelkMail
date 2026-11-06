import { readCookie, verifySession } from '../_lib/crypto'
import type { Env } from '../_lib/env'
import { fail, HttpError } from '../_lib/http'

const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/2fa',
  '/api/health',
  '/api/cron/notifications',
])

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'",
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    const request = context.request
    const url = new URL(request.url)

    if (!PUBLIC_PATHS.has(url.pathname)) {
      const session = readCookie(request, 'mc_session')
      if (!(await verifySession(context.env, session))) {
        return withSecurityHeaders(fail('Authentication required', 401, undefined, 'unauthorized'))
      }
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.get('Origin')
      if (origin && origin !== url.origin) {
        return withSecurityHeaders(fail('Origin not allowed', 403, undefined, 'invalid_origin'))
      }
    }

    return withSecurityHeaders(await context.next())
  } catch (error) {
    if (error instanceof HttpError) {
      return withSecurityHeaders(fail(error.message, error.status))
    }
    return withSecurityHeaders(fail('Internal error', 500, undefined, 'internal'))
  }
}
