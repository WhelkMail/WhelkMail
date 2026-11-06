import type { Env } from '../env'
import { fromBase64Url } from '../crypto'

const SCOPES = [
  'offline_access',
  'openid',
  'email',
  'profile',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ')

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

function tenant(env: Env): string {
  return env.MICROSOFT_TENANT?.trim() || 'common'
}

function tokenEndpoint(env: Env): string {
  return `https://login.microsoftonline.com/${tenant(env)}/oauth2/v2.0/token`
}

export function microsoftConfigured(env: Env): boolean {
  return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET)
}

export function buildMicrosoftAuthorizeUrl(
  env: Env,
  redirectUri: string,
  state: string,
  loginHint?: string,
  codeChallenge?: string,
): string {
  const url = new URL(`https://login.microsoftonline.com/${tenant(env)}/oauth2/v2.0/authorize`)
  url.searchParams.set('client_id', env.MICROSOFT_CLIENT_ID ?? '')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'consent')
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  if (loginHint) {
    url.searchParams.set('login_hint', loginHint)
  }
  return url.toString()
}

export async function exchangeMicrosoftCode(
  env: Env,
  code: string,
  redirectUri: string,
  codeVerifier?: string | null,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID ?? '',
    client_secret: env.MICROSOFT_CLIENT_SECRET ?? '',
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPES,
  })
  if (codeVerifier) {
    body.set('code_verifier', codeVerifier)
  }
  const response = await fetch(tokenEndpoint(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = (await response.json()) as TokenResponse
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Scambio codice Microsoft fallito')
  }
  return data
}

export async function refreshMicrosoftToken(env: Env, refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(tokenEndpoint(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID ?? '',
      client_secret: env.MICROSOFT_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES,
    }),
  })
  const data = (await response.json()) as TokenResponse
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Refresh token Microsoft fallito')
  }
  return data
}

export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) {
    return null
  }
  const parts = idToken.split('.')
  if (parts.length < 2) {
    return null
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as {
      preferred_username?: string
      email?: string
      upn?: string
    }
    return payload.preferred_username ?? payload.email ?? payload.upn ?? null
  } catch {
    return null
  }
}
