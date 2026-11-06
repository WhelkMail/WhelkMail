import { createOAuthState, pkceChallenge, randomToken } from '../../../_lib/crypto'
import { getAccountRow } from '../../../_lib/db'
import type { Env } from '../../../_lib/env'
import { fail } from '../../../_lib/http'
import { buildMicrosoftAuthorizeUrl, microsoftConfigured } from '../../../_lib/microsoft/oauth'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  if (!microsoftConfigured(context.env)) {
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
  if (row.kind !== 'imap' || row.auth_type !== 'oauth2') {
    return fail('Invalid OAuth provider', 400, undefined, 'oauth_invalid_provider')
  }
  const redirectUri = `${url.origin}/api/microsoft/oauth/callback`
  const verifier = randomToken(32)
  const state = await createOAuthState(context.env, accountId, 'microsoft', verifier)
  const challenge = await pkceChallenge(verifier)
  return Response.redirect(
    buildMicrosoftAuthorizeUrl(context.env, redirectUri, state, row.email, challenge),
    302,
  )
}
