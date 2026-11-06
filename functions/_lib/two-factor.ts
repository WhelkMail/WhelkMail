import { decryptString, encryptString } from './crypto'
import type { Env } from './env'
import { hashRecoveryCode, matchRecoveryCode, verifyTotp } from './totp'

const KEY_ENABLED = 'totp_enabled'
const KEY_SECRET = 'totp_secret_enc'
const KEY_RECOVERY = 'totp_recovery_json'

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

function settingStatement(env: Env, key: string, value: string): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value)
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await settingStatement(env, key, value).run()
}

export async function deleteSettings(env: Env, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return
  }
  const placeholders = keys.map(() => '?').join(', ')
  await env.DB.prepare(`DELETE FROM app_settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .run()
}

export async function isTwoFactorEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env, KEY_ENABLED)) === '1'
}

export async function getPendingSecret(env: Env): Promise<string | null> {
  const encrypted = await getSetting(env, KEY_SECRET)
  return encrypted ? decryptString(env, encrypted) : null
}

export async function storePendingSecret(env: Env, secret: string): Promise<void> {
  const encrypted = await encryptString(env, secret)
  await env.DB.batch([
    settingStatement(env, KEY_SECRET, encrypted),
    settingStatement(env, KEY_ENABLED, '0'),
    env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(KEY_RECOVERY),
  ])
}

export async function loadRecoveryHashes(env: Env): Promise<string[]> {
  const value = await getSetting(env, KEY_RECOVERY)
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export async function enableTwoFactor(
  env: Env,
  secret: string,
  recoveryCodes: string[],
): Promise<void> {
  const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode))
  const encrypted = await encryptString(env, secret)
  await env.DB.batch([
    settingStatement(env, KEY_SECRET, encrypted),
    settingStatement(env, KEY_RECOVERY, JSON.stringify(hashes)),
    settingStatement(env, KEY_ENABLED, '1'),
  ])
}

export async function disableTwoFactor(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(KEY_ENABLED),
    env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(KEY_SECRET),
    env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(KEY_RECOVERY),
  ])
}

export async function verifySecondFactor(env: Env, code: string): Promise<boolean> {
  if (!(await isTwoFactorEnabled(env))) {
    return false
  }
  const secret = await getPendingSecret(env)
  if (!secret) {
    return false
  }
  if (await verifyTotp(secret, code)) {
    return true
  }
  const hashes = await loadRecoveryHashes(env)
  const index = await matchRecoveryCode(code, hashes)
  if (index < 0) {
    return false
  }
  hashes.splice(index, 1)
  await setSetting(env, KEY_RECOVERY, JSON.stringify(hashes))
  return true
}
