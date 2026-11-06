import { consumeOAuthState, encryptString } from '../../../_lib/crypto'
import { getAccountRow } from '../../../_lib/db'
import {
  createDriveFolder,
  exchangeCode,
  fetchUserEmail,
} from '../../../_lib/drive/oauth'
import type { Env } from '../../../_lib/env'

function redirectBack(origin: string, params: Record<string, string>): Response {
  const search = new URLSearchParams(params)
  return Response.redirect(`${origin}/?${search.toString()}`, 302)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const origin = url.origin

  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    return redirectBack(origin, { drive: 'error', reason: oauthError })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return redirectBack(origin, { drive: 'error', reason: 'missing_code' })
  }

  const stateData = await consumeOAuthState(context.env, state, 'drive')
  if (!stateData) {
    return redirectBack(origin, { drive: 'error', reason: 'invalid_state' })
  }
  const accountId = stateData.accountId
  const row = await getAccountRow(context.env, accountId)
  if (!row) {
    return redirectBack(origin, { drive: 'error', reason: 'account_not_found' })
  }

  try {
    const tokens = await exchangeCode(
      context.env,
      code,
      `${origin}/api/drive/oauth/callback`,
      stateData.codeVerifier,
    )
    if (!tokens.refresh_token) {
      throw new Error('Google non ha restituito un refresh token')
    }
    const email = await fetchUserEmail(tokens.access_token)
    const folderId = row.drive_folder_id ?? (await createDriveFolder(tokens.access_token))
    const refreshEncrypted = await encryptString(context.env, tokens.refresh_token)
    const accessEncrypted = await encryptString(context.env, tokens.access_token)
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in

    await context.env.DB.prepare(
      'UPDATE accounts SET drive_email = ?, drive_folder_id = ?, drive_refresh_token_enc = ?, drive_access_token_enc = ?, drive_token_expires_at = ? WHERE id = ?',
    )
      .bind(
        email ?? row.drive_email,
        folderId,
        refreshEncrypted,
        accessEncrypted,
        expiresAt,
        accountId,
      )
      .run()

    return redirectBack(origin, { drive: 'connected', account: accountId })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown'
    return redirectBack(origin, { drive: 'error', reason })
  }
}
