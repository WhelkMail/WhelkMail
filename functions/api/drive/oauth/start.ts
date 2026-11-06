import { createOAuthState, pkceChallenge, randomToken } from '../../../_lib/crypto'
import { getAccountRow } from '../../../_lib/db'
import { buildAuthorizeUrl } from '../../../_lib/drive/oauth'
import type { Env } from '../../../_lib/env'
import { fail } from '../../../_lib/http'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  if (!context.env.GOOGLE_CLIENT_ID || !context.env.GOOGLE_CLIENT_SECRET) {
    return fail('OAuth is not configured', 503, undefined, 'oauth_not_configured')
  }
  const accountId = url.searchParams.get('accountId')
  if (!accountId) {
    return fail('Invalid request', 400, undefined, 'invalid_request')
  }
  const row = await getAccountRow(context.env, accountId)
  if (!row) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }
  const redirectUri = `${url.origin}/api/drive/oauth/callback`
  const verifier = randomToken(32)
  const state = await createOAuthState(context.env, accountId, 'drive', verifier)
  const challenge = await pkceChallenge(verifier)
  return Response.redirect(buildAuthorizeUrl(context.env, redirectUri, state, challenge), 302)
}
