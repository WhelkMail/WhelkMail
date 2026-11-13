import { decryptString, encryptString } from '../crypto'
import type { AccountRow } from '../db'
import type { Env } from '../env'
import { refreshGoogleToken } from '../google/oauth'
import { refreshMicrosoftToken } from '../microsoft/oauth'

export interface MailCredentials {
  username: string
  mode: 'password' | 'oauth2'
  password?: string
  accessToken?: string
}

export async function getMailCredentials(env: Env, account: AccountRow): Promise<MailCredentials> {
  const username = account.username ?? account.email
  if (account.auth_type === 'oauth2') {
    const now = Math.floor(Date.now() / 1000)
    if (
      account.access_token_enc &&
      account.access_token_expires_at &&
      account.access_token_expires_at > now + 60
    ) {
      return {
        username,
        mode: 'oauth2',
        accessToken: await decryptString(env, account.access_token_enc),
      }
    }
    if (!account.secret_enc) {
      throw new Error('OAuth account is not connected')
    }
    const refreshToken = await decryptString(env, account.secret_enc)
    let token: { access_token: string; expires_in: number; refresh_token?: string }
    if (account.oauth_provider === 'microsoft') {
      token = await refreshMicrosoftToken(env, refreshToken)
    } else if (account.oauth_provider === 'google') {
      token = await refreshGoogleToken(env, refreshToken)
    } else {
      throw new Error('Unsupported OAuth provider')
    }
    const accessEncrypted = await encryptString(env, token.access_token)
    const expiresAt = now + token.expires_in
    const refreshEncrypted = token.refresh_token
      ? await encryptString(env, token.refresh_token)
      : account.secret_enc
    await env.DB.prepare(
      'UPDATE accounts SET access_token_enc = ?, access_token_expires_at = ?, secret_enc = ? WHERE id = ?',
    )
      .bind(accessEncrypted, expiresAt, refreshEncrypted, account.id)
      .run()
    account.access_token_enc = accessEncrypted
    account.access_token_expires_at = expiresAt
    account.secret_enc = refreshEncrypted
    return { username, mode: 'oauth2', accessToken: token.access_token }
  }
  if (!account.secret_enc) {
    throw new Error('Password is not configured')
  }
  return {
    username,
    mode: 'password',
    password: await decryptString(env, account.secret_enc),
  }
}
