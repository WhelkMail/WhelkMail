import type { Env } from './env'

export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  /** Optional overrides for the notification images (must be bitmaps on Android). */
  icon?: string
  badge?: string
}

const encoder = new TextEncoder()

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, array) => sum + array.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const array of arrays) {
    result.set(array, offset)
    offset += array.length
  }
  return result
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

async function vapidAuthorization(env: Env, endpoint: string): Promise<string> {
  const publicKey = env.VAPID_PUBLIC_KEY ?? ''
  const privateKey = env.VAPID_PRIVATE_KEY ?? ''
  const publicBytes = base64UrlToBytes(publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error('VAPID public key non valida')
  }
  const x = bytesToBase64Url(publicBytes.slice(1, 33))
  const y = bytesToBase64Url(publicBytes.slice(33, 65))
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x, y, d: privateKey, ext: true }
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk as unknown as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: now + 12 * 60 * 60,
        sub: env.VAPID_SUBJECT || 'mailto:admin@whelkmail.local',
      }),
    ),
  )
  const data = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(data),
  )
  return `vapid t=${data}.${bytesToBase64Url(new Uint8Array(signature))}, k=${publicKey}`
}

async function encryptPayload(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
): Promise<Uint8Array> {
  const uaPublic = base64UrlToBytes(subscription.p256dh)
  const authSecret = base64UrlToBytes(subscription.auth)
  if (uaPublic.length !== 65 || authSecret.length !== 16) {
    throw new Error('Sottoscrizione push non valida')
  }
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const ephemeral = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair
  const ephemeralPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer,
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      ephemeral.privateKey,
      256,
    ),
  )
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const authInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, ephemeralPublic)
  const ikm = await hkdf(authSecret, shared, authInfo, 32)
  const cek = await hkdf(
    salt,
    ikm,
    encoder.encode('Content-Encoding: aes128gcm\0'),
    16,
  )
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plaintext = encoder.encode(JSON.stringify(payload))
  const record = new Uint8Array(plaintext.length + 1)
  record.set(plaintext)
  record[plaintext.length] = 2
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      record,
    ),
  )
  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, 4096)
  const idLength = new Uint8Array([ephemeralPublic.length])
  return concat(salt, recordSize, idLength, ephemeralPublic, encrypted)
}

export async function sendWebPush(
  env: Env,
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const authorization = await vapidAuthorization(env, subscription.endpoint)
  const body = await encryptPayload(subscription, payload)
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      TTL: '86400',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  })
  return {
    ok: response.ok,
    gone: response.status === 404 || response.status === 410,
    status: response.status,
  }
}
