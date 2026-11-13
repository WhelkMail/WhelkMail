import type { Env } from './env'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 300
const OAUTH_STATE_TTL_SECONDS = 600

export type OAuthKind = 'google' | 'microsoft' | 'drive'

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return fromBase64(normalized + padding)
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await sha256Bytes(value))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256Bytes(verifier))
}

function rawKey(env: Env): Uint8Array<ArrayBuffer> {
  const key = fromBase64(env.TOKEN_ENC_KEY)
  if (key.length !== 32) {
    throw new Error('TOKEN_ENC_KEY must be a base64-encoded 32-byte key')
  }
  return key
}

async function aesKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey(env), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', rawKey(env), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('whelkmail/hmac-v1'),
    },
    base,
    256,
  )
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(bits),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

export async function encryptString(env: Env, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(env),
    encoder.encode(value),
  )
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

export async function decryptString(env: Env, value: string): Promise<string> {
  const [ivPart, dataPart] = value.split('.')
  if (!ivPart || !dataPart) {
    throw new Error('Invalid encrypted token')
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    await aesKey(env),
    fromBase64(dataPart),
  )
  return decoder.decode(plaintext)
}

export async function sign(env: Env, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i]
  }
  return diff === 0
}

export async function cleanupExpiredAuth(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ? OR used = 1').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE window_start < ? AND (blocked_until IS NULL OR blocked_until <= ?)').bind(
        now - 60 * 60 * 24,
        now,
      ),
    ])
  } catch {
    // Best effort: cleanup must never block authentication.
  }
}

export async function createSession(env: Env, request?: Request): Promise<string> {
  const token = randomToken(32)
  const tokenHash = await sha256Hex(token)
  const now = Math.floor(Date.now() / 1000)
  const nowIso = new Date().toISOString()
  const ip = request?.headers.get('CF-Connecting-IP')?.slice(0, 64) ?? null
  const userAgent = request?.headers.get('User-Agent')?.slice(0, 300) ?? null
  await env.DB.prepare(
    'INSERT INTO sessions (id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), tokenHash, nowIso, now + SESSION_TTL_SECONDS, nowIso, ip, userAgent)
    .run()
  await cleanupExpiredAuth(env)
  return token
}

export async function verifySession(env: Env, token: string | null): Promise<boolean> {
  if (!token) {
    return false
  }
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare('SELECT id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ id: string; expires_at: number }>()
  if (!row) {
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.id).run()
    return false
  }
  return true
}

export async function revokeSession(env: Env, token: string | null): Promise<void> {
  if (!token) {
    return
  }
  const tokenHash = await sha256Hex(token)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

export async function verifyPassword(env: Env, password: string): Promise<boolean> {
  if (!env.APP_PASSWORD) {
    return false
  }
  return safeEqual(password, env.APP_PASSWORD)
}

export async function createTwoFactorChallenge(env: Env): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + TWO_FACTOR_CHALLENGE_TTL_SECONDS
  const nonce = randomToken(16)
  const payload = `2fa:${expires}:${nonce}`
  const signature = await sign(env, payload)
  return `${toBase64Url(encoder.encode(payload))}.${signature}`
}

export async function verifyTwoFactorChallenge(env: Env, challenge: string): Promise<boolean> {
  const [encoded, signature] = challenge.split('.')
  if (!encoded || !signature) {
    return false
  }
  let payload = ''
  try {
    payload = decoder.decode(fromBase64Url(encoded))
  } catch {
    return false
  }
  const expected = await sign(env, payload)
  if (!safeEqual(signature, expected)) {
    return false
  }
  const [prefix, expiresPart] = payload.split(':')
  const expires = Number(expiresPart)
  if (prefix !== '2fa' || !Number.isFinite(expires)) {
    return false
  }
  return expires >= Math.floor(Date.now() / 1000)
}

export async function createOAuthState(
  env: Env,
  accountId: string,
  kind: OAuthKind,
  codeVerifier: string,
): Promise<string> {
  const state = randomToken(32)
  const stateHash = await sha256Hex(state)
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    'INSERT INTO oauth_states (state_hash, kind, account_id, code_verifier, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, 0)',
  )
    .bind(stateHash, kind, accountId, codeVerifier, now, now + OAUTH_STATE_TTL_SECONDS)
    .run()
  return state
}

export async function consumeOAuthState(
  env: Env,
  state: string,
  kind: OAuthKind,
): Promise<{ accountId: string; codeVerifier: string | null } | null> {
  const stateHash = await sha256Hex(state)
  const now = Math.floor(Date.now() / 1000)
  const row = await env.DB.prepare(
    'SELECT account_id, code_verifier FROM oauth_states WHERE state_hash = ? AND kind = ? AND used = 0 AND expires_at > ?',
  )
    .bind(stateHash, kind, now)
    .first<{ account_id: string; code_verifier: string | null }>()
  if (!row) {
    return null
  }
  await env.DB.prepare('UPDATE oauth_states SET used = 1 WHERE state_hash = ?')
    .bind(stateHash)
    .run()
  return { accountId: row.account_id, codeVerifier: row.code_verifier }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) {
    return null
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      return rest.join('=')
    }
  }
  return null
}

export function sessionCookie(token: string, secure: boolean): string {
  const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  return `mc_session=${token}; ${attributes}${secure ? '; Secure' : ''}`
}

export function clearedSessionCookie(secure: boolean): string {
  return `mc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}
