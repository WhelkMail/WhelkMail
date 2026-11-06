import { consumeOAuthState, encryptString } from '../../../_lib/crypto'
import { getAccountRow } from '../../../_lib/db'
import type { Env } from '../../../_lib/env'
import { exchangeMicrosoftCode, emailFromIdToken, microsoftConfigured } from '../../../_lib/microsoft/oauth'

function redirectBack(origin: string, params: Record<string, string>): Response {
  return Response.redirect(`${origin}/?${new URLSearchParams(params).toString()}`, 302)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const origin = url.origin

  if (!microsoftConfigured(context.env)) {
    return redirectBack(origin, { microsoft: 'error', reason: 'not_configured' })
  }
  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    return redirectBack(origin, {
      microsoft: 'error',
      reason: url.searchParams.get('error_description') ?? oauthError,
    })
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return redirectBack(origin, { microsoft: 'error', reason: 'missing_code' })
  }
  const stateData = await consumeOAuthState(context.env, state, 'microsoft')
  if (!stateData) {
    return redirectBack(origin, { microsoft: 'error', reason: 'invalid_state' })
  }
  const accountId = stateData.accountId
  const row = await getAccountRow(context.env, accountId)
  if (!row) {
    return redirectBack(origin, { microsoft: 'error', reason: 'account_not_found' })
  }

  try {
    const tokens = await exchangeMicrosoftCode(
      context.env,
      code,
      `${origin}/api/microsoft/oauth/callback`,
      stateData.codeVerifier,
    )
    if (!tokens.refresh_token) {
      throw new Error('Microsoft non ha restituito un refresh token')
    }
    const actualEmail = emailFromIdToken(tokens.id_token)
    const refreshEncrypted = await encryptString(context.env, tokens.refresh_token)
    const accessEncrypted = await encryptString(context.env, tokens.access_token)
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in
    let email = row.email
    if (actualEmail && actualEmail.toLowerCase() !== row.email.toLowerCase()) {
      const conflict = await context.env.DB.prepare('SELECT id FROM accounts WHERE email = ? AND id != ?')
        .bind(actualEmail.toLowerCase(), accountId)
        .first<{ id: string }>()
      if (!conflict) {
        email = actualEmail.toLowerCase()
      }
    }
    await context.env.DB.prepare(
      'UPDATE accounts SET email = ?, username = ?, auth_type = ?, oauth_provider = ?, secret_enc = ?, access_token_enc = ?, access_token_expires_at = ? WHERE id = ?',
    )
      .bind(
        email,
        actualEmail ?? row.username ?? row.email,
        'oauth2',
        'microsoft',
        refreshEncrypted,
        accessEncrypted,
        expiresAt,
        accountId,
      )
      .run()
    return redirectBack(origin, { microsoft: 'connected', account: accountId })
  } catch (error) {
    return redirectBack(origin, {
      microsoft: 'error',
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }
}
