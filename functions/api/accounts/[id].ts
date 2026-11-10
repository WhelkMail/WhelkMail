import { findRelayProvider } from '../../../shared/presets'
import { accountUpdateSchema } from '../../../shared/schemas'
import { encryptString } from '../../_lib/crypto'
import { getAccountRow, publicAccount } from '../../_lib/db'
import { purgeAccountStorage } from '../../_lib/deletion'
import { backfillAccountLabel } from '../../_lib/filters'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const row = await getAccountRow(context.env, id)
  if (!row) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }
  const body = await readJson<unknown>(context.request)
  const parsed = accountUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid account data',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'invalid_account',
    )
  }
  const input = parsed.data
  if (row.kind === 'imap' && input.storageDriver && input.storageDriver !== 'provider') {
    return fail(
      'Attachments for IMAP accounts stay on the provider',
      400,
      undefined,
      'invalid_account',
    )
  }
  if (input.storageDriver === 'r2' && !context.env.BUCKET) {
    return fail('R2 is not configured on this deployment', 400, undefined, 'r2_not_configured')
  }
  const displayName = input.displayName ?? row.display_name
  const signature = input.signature === undefined ? row.signature : input.signature
  const incomingLabelId =
    input.incomingLabelId === undefined ? row.incoming_label_id : input.incomingLabelId
  const archiveImapBodies =
    input.archiveImapBodies === undefined ? row.archive_imap_bodies : input.archiveImapBodies ? 1 : 0
  const imapArchiveDriver =
    input.imapArchiveDriver ?? (row.imap_archive_driver === 'drive' ? 'drive' : 'r2')
  if (archiveImapBodies && imapArchiveDriver === 'r2' && !context.env.BUCKET) {
    return fail('R2 is not configured on this deployment', 400, undefined, 'r2_not_configured')
  }
  if (archiveImapBodies && imapArchiveDriver === 'drive' && !row.drive_refresh_token_enc) {
    return fail('Google Drive is not connected for this account', 400, undefined, 'drive_not_connected')
  }
  const requestedDelete =
    input.deleteAfterArchive === undefined ? Boolean(row.delete_after_archive) : input.deleteAfterArchive
  if (requestedDelete && !archiveImapBodies) {
    return fail(
      'Enable body archiving before deleting messages from the provider',
      400,
      undefined,
      'delete_requires_archive',
    )
  }
  const deleteAfterArchive = requestedDelete && archiveImapBodies ? 1 : 0
  const autoSync = input.autoSync === undefined ? Boolean(row.auto_sync) : input.autoSync
  if (incomingLabelId) {
    const label = await context.env.DB.prepare('SELECT id FROM labels WHERE id = ?')
      .bind(incomingLabelId)
      .first<{ id: string }>()
    if (!label) {
      return fail('Label not found', 404, undefined, 'label_not_found')
    }
  }
  const sentFolder = input.sentFolder ?? row.sent_folder
  const autoSavesSent = input.autoSavesSent === undefined ? row.auto_saves_sent : input.autoSavesSent ? 1 : 0
  const sentCopyAccountId =
    input.sentCopyAccountId === undefined ? row.sent_copy_account_id : input.sentCopyAccountId
  if (sentCopyAccountId) {
    if (row.kind !== 'relay') {
      return fail(
        'Only send-only accounts can copy sent mail into another account',
        400,
        undefined,
        'sent_copy_not_supported',
      )
    }
    if (sentCopyAccountId === row.id) {
      return fail(
        'Choose a different account for the sent copy',
        400,
        undefined,
        'sent_copy_invalid_target',
      )
    }
    const sentCopyTarget = await getAccountRow(context.env, sentCopyAccountId)
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
  }
  const storageDriver = input.storageDriver ?? row.storage_driver
  const username = input.username ?? row.username
  const imapHost = input.imapHost ?? row.imap_host
  const imapPort = input.imapPort ?? row.imap_port
  const imapSecurity = input.imapSecurity ?? row.imap_security
  const smtpHost = input.smtpHost ?? row.smtp_host
  const smtpPort = input.smtpPort ?? row.smtp_port
  const smtpSecurity = input.smtpSecurity ?? row.smtp_security
  if (row.kind === 'imap' && (!imapHost || !imapPort || !imapSecurity || !smtpHost || !smtpPort || !smtpSecurity)) {
    return fail('IMAP/SMTP configuration is incomplete', 400, undefined, 'imap_config_incomplete')
  }
  const secretEncrypted = input.password
    ? await encryptString(context.env, input.password)
    : row.secret_enc
  const isRelay = row.kind === 'relay'
  const relayProvider = isRelay
    ? (input.relayProvider ?? row.relay_provider ?? 'smtp2go').toLowerCase()
    : row.relay_provider
  const relayApiKeyEnc = isRelay && input.relayApiKey
    ? await encryptString(context.env, input.relayApiKey)
    : row.relay_api_key_enc
  const relayApiSecretEnc = isRelay && input.relayApiSecret
    ? await encryptString(context.env, input.relayApiSecret)
    : row.relay_api_secret_enc
  const relayDomain = isRelay ? (input.relayDomain ?? row.relay_domain) : row.relay_domain
  const relayRegion = isRelay ? (input.relayRegion ?? row.relay_region) : row.relay_region

  if (row.kind === 'relay') {
    const providerMeta = findRelayProvider(relayProvider ?? undefined)
    if (!providerMeta) {
      return fail('Unsupported relay provider', 400, undefined, 'relay_provider_unsupported')
    }
    if (providerMeta.manual && (!smtpHost || !smtpPort || !smtpSecurity)) {
      return fail('SMTP configuration is incomplete', 400, undefined, 'hosts_required')
    }
    if (providerMeta.needsSecret && !relayApiSecretEnc) {
      return fail('Relay API secret is required', 400, undefined, 'relay_secret_required')
    }
    if (providerMeta.needsDomain && !relayDomain) {
      return fail('Mailgun domain is required', 400, undefined, 'relay_domain_required')
    }
  }

  await context.env.DB.prepare(
    'UPDATE accounts SET display_name = ?, signature = ?, incoming_label_id = ?, archive_imap_bodies = ?, imap_archive_driver = ?, delete_after_archive = ?, auto_sync = ?, sent_folder = ?, auto_saves_sent = ?, sent_copy_account_id = ?, storage_driver = ?, username = ?, secret_enc = ?, relay_provider = ?, relay_api_key_enc = ?, relay_api_secret_enc = ?, relay_domain = ?, relay_region = ?, imap_host = ?, imap_port = ?, imap_security = ?, smtp_host = ?, smtp_port = ?, smtp_security = ? WHERE id = ?',
  )
    .bind(
      displayName,
      signature,
      incomingLabelId,
      archiveImapBodies,
      imapArchiveDriver,
      deleteAfterArchive,
      autoSync,
      sentFolder,
      autoSavesSent,
      sentCopyAccountId,
      storageDriver,
      username,
      secretEncrypted,
      relayProvider,
      relayApiKeyEnc,
      relayApiSecretEnc,
      relayDomain,
      relayRegion,
      imapHost,
      imapPort,
      imapSecurity,
      smtpHost,
      smtpPort,
      smtpSecurity,
      id,
    )
    .run()

  if (incomingLabelId && incomingLabelId !== row.incoming_label_id) {
    await backfillAccountLabel(context.env, id, incomingLabelId)
  }

  const updated = await getAccountRow(context.env, id)
  if (!updated) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }
  return json({ account: publicAccount(updated, Boolean(context.env.BUCKET)) })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const row = await getAccountRow(context.env, id)
  if (!row) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }
  await purgeAccountStorage(context.env, row).catch(() => undefined)
  await context.env.DB.prepare('DELETE FROM imap_body_cache WHERE account_id = ?')
    .bind(id)
    .run()
    .catch(() => undefined)
  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM message_labels WHERE account_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM imap_messages WHERE account_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM imap_sync WHERE account_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM forward_log WHERE account_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM deletion_log WHERE account_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM push_prefs WHERE account_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM messages WHERE account_id = ?').bind(id),
    context.env.DB.prepare('UPDATE accounts SET sent_copy_account_id = NULL WHERE sent_copy_account_id = ?').bind(id),
    context.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id),
  ])
  return json({ ok: true })
}
