import { consumeOAuthState, encryptString } from '../../../_lib/crypto'
import { getAccountRow } from '../../../_lib/db'
import type { Env } from '../../../_lib/env'
import {
  exchangeGoogleCode,
  googleEmailFromIdToken,
  googleMailConfigured,
} from '../../../_lib/google/oauth'

function redirectBack(origin: string, params: Record<string, string>): Response {
  return Response.redirect(`${origin}/?${new URLSearchParams(params).toString()}`, 302)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const origin = url.origin

  if (!googleMailConfigured(context.env)) {
    return redirectBack(origin, { google: 'error', reason: 'not_configured' })
  }
  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    return redirectBack(origin, {
      google: 'error',
      reason: url.searchParams.get('error_description') ?? oauthError,
    })
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return redirectBack(origin, { google: 'error', reason: 'missing_code' })
  }
  const stateData = await consumeOAuthState(context.env, state, 'google')
  if (!stateData) {
    return redirectBack(origin, { google: 'error', reason: 'invalid_state' })
  }
  const accountId = stateData.accountId
  const row = await getAccountRow(context.env, accountId)
  if (!row) {
    return redirectBack(origin, { google: 'error', reason: 'account_not_found' })
  }

  try {
    const tokens = await exchangeGoogleCode(
      context.env,
      code,
      `${origin}/api/google/oauth/callback`,
      stateData.codeVerifier,
    )
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token')
    }
    const actualEmail = googleEmailFromIdToken(tokens.id_token)
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
        'google',
        refreshEncrypted,
        accessEncrypted,
        expiresAt,
        accountId,
      )
      .run()
    return redirectBack(origin, { google: 'connected', account: accountId })
  } catch (error) {
    return redirectBack(origin, {
      google: 'error',
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }
}
