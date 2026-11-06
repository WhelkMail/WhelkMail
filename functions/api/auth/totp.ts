import { verifyPassword } from '../../_lib/crypto'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import {
  disableTwoFactor,
  enableTwoFactor,
  getPendingSecret,
  isTwoFactorEnabled,
  loadRecoveryHashes,
  storePendingSecret,
  verifySecondFactor,
} from '../../_lib/two-factor'
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from '../../_lib/totp'

interface TotpBody {
  action?: 'setup' | 'enable' | 'disable'
  code?: string
  password?: string
}

async function accountLabel(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT email FROM accounts ORDER BY created_at ASC LIMIT 1').first<{
    email: string
  }>()
  return row?.email ?? 'admin'
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const enabled = await isTwoFactorEnabled(context.env)
  const hashes = enabled ? await loadRecoveryHashes(context.env) : []
  return json({ enabled, recoveryRemaining: hashes.length })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<TotpBody>(context.request)
  const enabled = await isTwoFactorEnabled(context.env)

  if (body.action === 'setup') {
    if (enabled) {
      return fail('Two-factor authentication is already enabled', 400, undefined, 'totp_already_enabled')
    }
    const secret = generateTotpSecret()
    await storePendingSecret(context.env, secret)
    return json({
      secret,
      otpauth: otpauthUri(secret, await accountLabel(context.env)),
    })
  }

  if (body.action === 'enable') {
    if (enabled) {
      return fail('Two-factor authentication is already enabled', 400, undefined, 'totp_already_enabled')
    }
    const secret = await getPendingSecret(context.env)
    if (!secret) {
      return fail('Start the setup first', 400, undefined, 'totp_setup_missing')
    }
    if (!body.code || !(await verifyTotp(secret, body.code))) {
      return fail('Invalid authentication code', 400, undefined, 'totp_invalid')
    }
    const recoveryCodes = generateRecoveryCodes()
    await enableTwoFactor(context.env, secret, recoveryCodes)
    return json({ recoveryCodes })
  }

  if (body.action === 'disable') {
    if (!enabled) {
      return fail('Two-factor authentication is not enabled', 400, undefined, 'totp_not_enabled')
    }
    if (!body.password || !(await verifyPassword(context.env, body.password))) {
      return fail('Invalid password', 401, undefined, 'login_failed')
    }
    if (!body.code || !(await verifySecondFactor(context.env, body.code))) {
      return fail('Invalid authentication code', 401, undefined, 'totp_invalid')
    }
    await disableTwoFactor(context.env)
    return json({ ok: true })
  }

  return fail('Invalid action', 400, undefined, 'invalid_action')
}
