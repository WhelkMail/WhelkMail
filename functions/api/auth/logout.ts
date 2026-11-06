import { clearedSessionCookie, readCookie, revokeSession } from '../../_lib/crypto'
import type { Env } from '../../_lib/env'
import { isSecure, json } from '../../_lib/http'

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await revokeSession(context.env, readCookie(context.request, 'mc_session'))
  return json({ ok: true }, 200, {
    'Set-Cookie': clearedSessionCookie(isSecure(context.request)),
  })
}
