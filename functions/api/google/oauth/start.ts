import { createOAuthState, pkceChallenge, randomToken } from '../../../_lib/crypto'
import { getAccountRow } from '../../../_lib/db'
import type { Env } from '../../../_lib/env'
import { buildGoogleAuthorizeUrl, googleMailConfigured } from '../../../_lib/google/oauth'
import { fail } from '../../../_lib/http'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  if (!googleMailConfigured(context.env)) {
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
  if (row.kind !== 'imap' || row.auth_type !== 'oauth2' || row.oauth_provider !== 'google') {
    return fail('Invalid OAuth provider', 400, undefined, 'oauth_invalid_provider')
  }
  const redirectUri = `${url.origin}/api/google/oauth/callback`
  const verifier = randomToken(32)
  const state = await createOAuthState(context.env, accountId, 'google', verifier)
  const challenge = await pkceChallenge(verifier)
  return Response.redirect(
    buildGoogleAuthorizeUrl(context.env, redirectUri, state, row.email, challenge),
    302,
  )
}
