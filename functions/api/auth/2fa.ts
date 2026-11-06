import {
  createSession,
  sessionCookie,
  verifyTwoFactorChallenge,
} from '../../_lib/crypto'
import type { Env } from '../../_lib/env'
import { fail, isSecure, json, readJson } from '../../_lib/http'
import {
  checkLoginRate,
  clearLoginFailures,
  clientIp,
  recordLoginFailure,
} from '../../_lib/rate-limit'
import { isTwoFactorEnabled, verifySecondFactor } from '../../_lib/two-factor'

interface TwoFactorBody {
  challenge?: string
  code?: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<TwoFactorBody>(context.request)
  const ip = clientIp(context.request)
  const rate = await checkLoginRate(context.env, ip)
  if (!rate.allowed) {
    return fail(
      'Too many attempts',
      429,
      undefined,
      'too_many_attempts',
      { 'Retry-After': String(rate.retryAfter) },
    )
  }
  if (!(await isTwoFactorEnabled(context.env))) {
    return fail('Two-factor authentication is not enabled', 400, undefined, 'totp_not_enabled')
  }
  if (!body.challenge || !(await verifyTwoFactorChallenge(context.env, body.challenge))) {
    return fail('Invalid or expired challenge', 401, undefined, 'totp_challenge_invalid')
  }
  if (!body.code || !(await verifySecondFactor(context.env, body.code))) {
    await recordLoginFailure(context.env, ip)
    return fail('Invalid authentication code', 401, undefined, 'totp_invalid')
  }
  await clearLoginFailures(context.env, ip)
  const token = await createSession(context.env, context.request)
  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie(token, isSecure(context.request)),
  })
}
