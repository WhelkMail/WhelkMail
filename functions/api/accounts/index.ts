import { accountCreateSchema } from '../../../shared/schemas'
import { findPreset, findRelayProvider } from '../../../shared/presets'
import { encryptString } from '../../_lib/crypto'
import { getAccountRow, listAccountRows, publicAccount } from '../../_lib/db'
import { backfillAccountLabel } from '../../_lib/filters'
import type { Env } from '../../_lib/env'
import { ensureGlobalLabel } from '../../_lib/labels'
import { googleMailConfigured } from '../../_lib/google/oauth'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError } from '../../_lib/schema'
import { microsoftConfigured } from '../../_lib/microsoft/oauth'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const rows = await listAccountRows(context.env)
  const r2Available = Boolean(context.env.BUCKET)
  return json({ accounts: rows.map((row) => publicAccount(row, r2Available)) })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<unknown>(context.request)
  const parsed = accountCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid account data',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'invalid_account',
    )
  }
  const input = parsed.data
  const existing = await context.env.DB.prepare('SELECT id FROM accounts WHERE email = ?')
    .bind(input.email)
    .first<{ id: string }>()
  if (existing) {
    return fail('An account with this email already exists', 409, undefined, 'account_exists')
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  if (input.kind === 'imap') {
    const preset = findPreset(input.preset ?? 'custom')
    const imapHost = input.imapHost ?? preset?.imapHost ?? ''
    const imapPort = input.imapPort ?? preset?.imapPort ?? 993
    const imapSecurity = input.imapSecurity ?? preset?.imapSecurity ?? 'tls'
    const smtpHost = input.smtpHost ?? preset?.smtpHost ?? ''
    const smtpPort = input.smtpPort ?? preset?.smtpPort ?? 465
    const smtpSecurity = input.smtpSecurity ?? preset?.smtpSecurity ?? 'tls'
    const authType = input.authType ?? preset?.authType ?? 'password'
    const oauthProvider =
      input.oauthProvider ??
      (input.preset === 'outlook' ? 'microsoft' : input.preset === 'gmail' ? 'google' : undefined)
    if (!imapHost || !smtpHost) {
      return fail('IMAP and SMTP hosts are required', 400, undefined, 'hosts_required')
    }
    if (authType === 'oauth2') {
      if (oauthProvider === 'google') {
        if (!googleMailConfigured(context.env)) {
          return fail('OAuth is not configured', 503, undefined, 'oauth_not_configured')
        }
      } else if (oauthProvider === 'microsoft') {
        if (!microsoftConfigured(context.env)) {
          return fail('OAuth is not configured', 503, undefined, 'oauth_not_configured')
        }
      } else {
        return fail('Invalid OAuth provider', 400, undefined, 'oauth_invalid_provider')
      }
    } else if (!input.password) {
      return fail('Password or app password is required', 400, undefined, 'password_required')
    }
    const secretEncrypted = input.password
      ? await encryptString(context.env, input.password)
      : null
    await context.env.DB.prepare(
      `INSERT INTO accounts (id, email, display_name, kind, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username, auth_type, secret_enc, oauth_provider, sent_folder, auto_sync, auto_saves_sent, max_attachment_bytes, storage_driver, relay_provider, created_at)
       VALUES (?, ?, ?, 'imap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sent', 1, ?, ?, 'provider', NULL, ?)`,
    )
      .bind(
        id,
        input.email,
        input.displayName,
        imapHost,
        imapPort,
        imapSecurity,
        smtpHost,
        smtpPort,
        smtpSecurity,
        input.username ?? input.email,
        authType,
        secretEncrypted,
        authType === 'oauth2' ? oauthProvider ?? null : null,
        (input.autoSavesSent ?? preset?.autoSavesSent) ? 1 : 0,
        preset?.maxAttachmentBytes ?? 15 * 1024 * 1024,
        createdAt,
      )
      .run()
  } else {
    if (input.storageDriver === 'r2' && !context.env.BUCKET) {
      return fail('R2 is not configured on this deployment', 400, undefined, 'r2_not_configured')
    }
    let sentCopyAccountId: string | null = null
    if (input.storageDriver === 'imap') {
      if (!input.sentCopyAccountId) {
        return fail(
          'Choose the IMAP account that stores the sent copy',
          400,
          undefined,
          'sent_copy_target_required',
        )
      }
      const sentCopyTarget = await getAccountRow(context.env, input.sentCopyAccountId)
      if (!sentCopyTarget || sentCopyTarget.kind !== 'imap') {
        return fail(
          'The sent copy target must be an IMAP account',
          400,
          undefined,
          'sent_copy_invalid_target',
        )
      }
      if (!sentCopyTarget.secret_enc) {
        return fail(
          'Connect the target account before copying sent mail into it',
          400,
          undefined,
          'sent_copy_target_not_connected',
        )
      }
      sentCopyAccountId = sentCopyTarget.id
    }
    const provider = (input.relayProvider ?? context.env.RELAY_PROVIDER ?? 'smtp2go').toLowerCase()
    const providerMeta = findRelayProvider(provider)
    if (!providerMeta) {
      return fail('Unsupported relay provider', 400, undefined, 'relay_provider_unsupported')
    }
    const customSmtp = provider === 'custom'
    if (customSmtp && !input.smtpHost) {
      return fail('Hosts are required', 400, undefined, 'hosts_required')
    }
    const smtpPort = customSmtp ? (input.smtpPort ?? 465) : null
    const smtpSecurity = customSmtp ? (input.smtpSecurity ?? 'tls') : null
    const username = customSmtp ? (input.username ?? input.email) : null
    const apiKey =
      input.relayApiKey ??
      context.env.RELAY_API_KEY ??
      (provider === 'smtp2go' ? context.env.SMTP2GO_API_KEY : undefined)
    if (!apiKey && !customSmtp) {
      return fail('Relay API key is required', 400, undefined, 'relay_key_required')
    }
    if (providerMeta.needsSecret && !input.relayApiSecret) {
      return fail('Relay API secret is required', 400, undefined, 'relay_secret_required')
    }
    if (providerMeta.needsDomain && !input.relayDomain) {
      return fail('Mailgun domain is required', 400, undefined, 'relay_domain_required')
    }
    const keyEncrypted = apiKey ? await encryptString(context.env, apiKey) : null
    const secretEncrypted = input.relayApiSecret
      ? await encryptString(context.env, input.relayApiSecret)
      : null
    await context.env.DB.prepare(
      `INSERT INTO accounts (id, email, display_name, kind, auth_type, sent_folder, auto_saves_sent, sent_copy_account_id, max_attachment_bytes, storage_driver, relay_provider, relay_api_key_enc, relay_api_secret_enc, relay_domain, relay_region, smtp_host, smtp_port, smtp_security, username, created_at)
       VALUES (?, ?, ?, 'relay', 'none', 'Sent', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.email,
        input.displayName,
        sentCopyAccountId,
        15 * 1024 * 1024,
        input.storageDriver,
        provider,
        keyEncrypted,
        secretEncrypted,
        input.relayDomain ?? null,
        input.relayRegion ?? null,
        customSmtp ? (input.smtpHost ?? null) : null,
        smtpPort,
        smtpSecurity,
        username,
        createdAt,
      )
      .run()
  }

  if (input.incomingLabelName) {
    try {
      const labelId = await ensureGlobalLabel(context.env, input.incomingLabelName)
      await context.env.DB.prepare('UPDATE accounts SET incoming_label_id = ? WHERE id = ?')
        .bind(labelId, id)
        .run()
      await backfillAccountLabel(context.env, id, labelId)
    } catch (error) {
      if (!isSchemaError(error)) {
        throw error
      }
    }
  }

  const row = await getAccountRow(context.env, id)
  if (!row) {
    return fail('Internal error', 500, undefined, 'internal')
  }
  return json({ account: publicAccount(row, Boolean(context.env.BUCKET)) }, 201)
}
