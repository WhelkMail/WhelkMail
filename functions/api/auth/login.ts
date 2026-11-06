import {
  createSession,
  createTwoFactorChallenge,
  sessionCookie,
  verifyPassword,
} from '../../_lib/crypto'
import type { Env } from '../../_lib/env'
import { fail, isSecure, json, readJson } from '../../_lib/http'
import {
  checkLoginRate,
  clearLoginFailures,
  clientIp,
  recordLoginFailure,
} from '../../_lib/rate-limit'
import { isTwoFactorEnabled } from '../../_lib/two-factor'

interface LoginBody {
  password?: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<LoginBody>(context.request)
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
  if (!body.password || !(await verifyPassword(context.env, body.password))) {
    await recordLoginFailure(context.env, ip)
    return fail('Invalid password', 401, undefined, 'login_failed')
  }
  if (await isTwoFactorEnabled(context.env)) {
    return json({
      ok: false,
      twoFactorRequired: true,
      challenge: await createTwoFactorChallenge(context.env),
    })
  }
  await clearLoginFailures(context.env, ip)
  const token = await createSession(context.env, context.request)
  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie(token, isSecure(context.request)),
  })
}
