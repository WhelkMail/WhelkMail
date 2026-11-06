import { fromBase64Url } from '../crypto'
import type { Env } from '../env'

const SCOPES = ['openid', 'email', 'https://mail.google.com/'].join(' ')

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

export function googleMailConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_MAIL_CLIENT_ID && env.GOOGLE_MAIL_CLIENT_SECRET)
}

export function buildGoogleAuthorizeUrl(
  env: Env,
  redirectUri: string,
  state: string,
  loginHint?: string,
  codeChallenge?: string,
): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', env.GOOGLE_MAIL_CLIENT_ID ?? '')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  if (loginHint) {
    url.searchParams.set('login_hint', loginHint)
  }
  return url.toString()
}

export async function exchangeGoogleCode(
  env: Env,
  code: string,
  redirectUri: string,
  codeVerifier?: string | null,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_MAIL_CLIENT_ID ?? '',
    client_secret: env.GOOGLE_MAIL_CLIENT_SECRET ?? '',
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  if (codeVerifier) {
    body.set('code_verifier', codeVerifier)
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = (await response.json()) as TokenResponse
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Scambio codice Google fallito')
  }
  return data
}

export async function refreshGoogleToken(env: Env, refreshToken: string): Promise<TokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_MAIL_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_MAIL_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  })
  const data = (await response.json()) as TokenResponse
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Refresh token Google fallito')
  }
  return data
}

export function googleEmailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) {
    return null
  }
  const parts = idToken.split('.')
  if (parts.length < 2) {
    return null
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as {
      email?: string
    }
    return payload.email ?? null
  } catch {
    return null
  }
}
