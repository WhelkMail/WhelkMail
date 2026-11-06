import type { Env } from '../env'

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

interface UserInfoResponse {
  email?: string
}

interface DriveFileResponse {
  id?: string
  error?: { message?: string }
}

export const DRIVE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

export function buildAuthorizeUrl(
  env: Env,
  redirectUri: string,
  state: string,
  codeChallenge?: string,
): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', DRIVE_SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
  codeVerifier?: string | null,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
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
  const data = (await response.json()) as TokenResponse & { error?: string; error_description?: string }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Scambio codice Google fallito')
  }
  return data
}

export async function refreshAccessToken(env: Env, refreshToken: string): Promise<TokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  const data = (await response.json()) as TokenResponse & { error?: string; error_description?: string }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Refresh token Google fallito')
  }
  return data
}

export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    return null
  }
  const data = (await response.json()) as UserInfoResponse
  return data.email ?? null
}

export async function createDriveFolder(accessToken: string, name = 'WhelkMail'): Promise<string> {
  const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  })
  const data = (await response.json()) as DriveFileResponse
  if (!response.ok || !data.id) {
    throw new Error(data.error?.message ?? 'Creazione cartella Drive fallita')
  }
  return data.id
}
