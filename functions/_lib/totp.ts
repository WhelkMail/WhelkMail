import { safeEqual, sha256Hex } from './crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(bytes = 20): string {
  const random = crypto.getRandomValues(new Uint8Array(bytes))
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of random) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(secret: string): Uint8Array {
  const normalized = secret.replace(/[\s-]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) {
      continue
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(output)
}

async function codeForCounter(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigUint64(0, BigInt(counter))
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer))
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  const normalized = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalized)) {
    return false
  }
  const counter = Math.floor(Date.now() / 1000 / 30)
  for (let index = -window; index <= window; index += 1) {
    if (await codeForCounter(secret, counter + index) === normalized) {
      return true
    }
  }
  return false
}

export function otpauthUri(secret: string, account: string, issuer = 'WhelkMail'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    let raw = ''
    for (const byte of bytes) {
      raw += ALPHABET[byte & 31]
    }
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return sha256Hex(normalizeRecoveryCode(code))
}

export async function matchRecoveryCode(code: string, hashes: string[]): Promise<number> {
  const hash = await hashRecoveryCode(code)
  for (let index = 0; index < hashes.length; index += 1) {
    if (safeEqual(hash, hashes[index])) {
      return index
    }
  }
  return -1
}
