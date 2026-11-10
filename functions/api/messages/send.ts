import { sendSchema } from '../../../shared/schemas'
import type { AttachmentMeta, Mailbox } from '../../../shared/types'
import { fromBase64 } from '../../_lib/crypto'
import {
  getAccountRow,
  mailboxesFromAddresses,
  relayMessageSummary,
  type AccountRow,
  type MessageRow,
} from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { deleteDraftById } from '../../_lib/mail/drafts'
import { appendToSent } from '../../_lib/mail/imap'
import { sendWithAccount } from '../../_lib/mail/smtp'
import { queueSync } from '../../_lib/sync'
import { buildMime, snippetOf } from '../../_lib/mime'
import { getRelay, type RelayAdapter } from '../../_lib/relay'
import { getStorage } from '../../_lib/storage'

interface PersistInput {
  env: Env
  account: AccountRow
  id: string
  messageId: string
  to: Mailbox[]
  cc: Mailbox[]
  bcc: Mailbox[]
  subject: string
  snippet: string
  bodyText: string
  bodyHtml: string | null
  sentAt: string
  size: number
  storageKey: string
  attachments: AttachmentMeta[]
  status: 'sent' | 'failed'
}

async function persistRelayMessage(input: PersistInput): Promise<MessageRow> {
  const createdAt = new Date().toISOString()
  await input.env.DB.prepare(
    'INSERT INTO messages (id, account_id, folder, message_id, from_name, from_email, to_json, cc_json, bcc_json, subject, snippet, body_text, body_html, sent_at, size, storage_driver, storage_key, attachments_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      input.id,
      input.account.id,
      'sent',
      input.messageId,
      input.account.display_name,
      input.account.email,
      JSON.stringify(input.to),
      JSON.stringify(input.cc),
      JSON.stringify(input.bcc),
      input.subject,
      input.snippet,
      input.bodyText,
      input.bodyHtml,
      input.sentAt,
      input.size,
      input.account.storage_driver,
      input.storageKey,
      JSON.stringify(input.attachments),
      input.status,
      createdAt,
    )
    .run()
  const row = await input.env.DB.prepare('SELECT * FROM messages WHERE id = ?')
    .bind(input.id)
    .first<MessageRow>()
  if (!row) {
    throw new Error('Persistenza messaggio fallita')
  }
  return row
}

/**
 * Send-only accounts keep their sent copies on Drive/R2. Optionally the same
 * message is appended to the Sent folder of an IMAP account, so the copy also
 * shows up in a real mailbox the user already reads.
 */
async function copySentToImapAccount(
  env: Env,
  account: AccountRow,
  mime: Uint8Array,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<string | undefined> {
  const targetId = account.sent_copy_account_id
  if (!targetId) {
    return undefined
  }
  const target = await getAccountRow(env, targetId)
  if (!target || target.kind !== 'imap') {
    return undefined
  }
  try {
    await appendToSent(env, target, mime)
  } catch (error) {
    return `Messaggio inviato, ma la copia in ${target.sent_folder || 'Sent'} di ${target.email} non è stata salvata: ${
      error instanceof Error ? error.message : 'errore IMAP'
    }`
  }
  await queueSync(env, target, 'sent', waitUntil).catch(() => undefined)
  return undefined
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<unknown>(context.request)
  const parsed = sendSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid message',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'message_invalid',
    )
  }
  const input = parsed.data
  const account = await getAccountRow(context.env, input.accountId)
  if (!account) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }

  const estimatedBytes = input.attachments.reduce(
    (total, attachment) => total + Math.ceil((attachment.dataBase64.length * 3) / 4),
    0,
  )
  if (estimatedBytes > account.max_attachment_bytes) {
    return fail(
      `Attachments too large: limit ${Math.floor(account.max_attachment_bytes / (1024 * 1024))} MB`,
      413,
      undefined,
      'attachment_too_large',
    )
  }
  let attachments: { filename: string; contentType: string; content: Uint8Array }[]
  try {
    attachments = input.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: fromBase64(attachment.dataBase64),
    }))
  } catch {
    return fail('Invalid attachment data', 400, undefined, 'attachment_invalid')
  }
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.content.byteLength, 0)
  if (totalBytes > account.max_attachment_bytes) {
    return fail(
      `Attachments too large: limit ${Math.floor(account.max_attachment_bytes / (1024 * 1024))} MB`,
      413,
      undefined,
      'attachment_too_large',
    )
  }
  const attachmentMeta: AttachmentMeta[] = attachments.map((attachment, index) => ({
    index,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.content.byteLength,
  }))

  const id = crypto.randomUUID()
  const domain = account.email.split('@')[1] ?? 'localhost'
  const messageId = `<${id}@${domain}>`
  const now = new Date()
  const to = mailboxesFromAddresses(input.to)
  const cc = mailboxesFromAddresses(input.cc)
  const bcc = mailboxesFromAddresses(input.bcc)
  const subject = input.subject.trim()
  const snippet = snippetOf(input.text)

  if (account.kind === 'imap') {
    if (totalBytes > account.max_attachment_bytes) {
      return fail(
        `Attachments too large: limit ${Math.floor(account.max_attachment_bytes / (1024 * 1024))} MB`,
        413,
        undefined,
        'attachment_too_large',
      )
    }
    if (!account.secret_enc) {
      return fail('Account is not connected', 400, undefined, 'imap_not_connected')
    }
    const mimeBase = {
      from: { name: account.display_name, email: account.email },
      to,
      cc,
      bcc,
      subject,
      text: input.text,
      html: input.html,
      attachments,
      messageId,
      date: now,
    }
    const mime = buildMime(mimeBase)
    const transportMime = buildMime({ ...mimeBase, includeBcc: false })
    try {
      await sendWithAccount(context.env, account, transportMime, [
        ...input.to,
        ...input.cc,
        ...input.bcc,
      ])
    } catch (error) {
      return fail(
        'SMTP send failed',
        502,
        error instanceof Error ? error.message : 'SMTP error',
        'smtp_failed',
      )
    }
    let warning: string | undefined
    let sentFolder: string | undefined
    if (!account.auto_saves_sent) {
      try {
        const appended = await appendToSent(context.env, account, mime)
        sentFolder = appended.folder
        if (appended.folder !== account.sent_folder) {
          await context.env.DB.prepare('UPDATE accounts SET sent_folder = ? WHERE id = ?')
            .bind(appended.folder, account.id)
            .run()
          account.sent_folder = appended.folder
        }
      } catch (error) {
        warning = `Messaggio inviato, ma la copia in ${account.sent_folder} non è stata salvata: ${
          error instanceof Error ? error.message : 'errore IMAP'
        }`
      }
    }
    if (input.draftId) {
      await deleteDraftById(context.env, input.draftId).catch(() => undefined)
    }
    await queueSync(context.env, account, 'sent', (promise) => context.waitUntil(promise)).catch(() => undefined)
    return json({ ok: true, warning, sentFolder })
  }

  if (account.storage_driver === 'r2' && !context.env.BUCKET) {
    return fail('R2 is not configured on this deployment', 400, undefined, 'r2_not_configured')
  }
  let relay: RelayAdapter
  try {
    relay = await getRelay(context.env, account)
  } catch (error) {
    return fail(
      'Relay is not configured',
      503,
      error instanceof Error ? error.message : 'Missing configuration',
      'relay_not_configured',
    )
  }
  if (totalBytes > relay.maxAttachmentBytes) {
    return fail(
      `Attachments too large: limit ${Math.floor(relay.maxAttachmentBytes / (1024 * 1024))} MB for ${relay.label}`,
      413,
      undefined,
      'attachment_too_large',
    )
  }
  const mime = buildMime({
    from: { name: account.display_name, email: account.email },
    to,
    cc,
    bcc,
    subject,
    text: input.text,
    html: input.html,
    attachments,
    messageId,
    date: now,
  })
  const objectKey =
    account.storage_driver === 'r2'
      ? `accounts/${account.id}/sent/${id}.eml`
      : `sent/${id}.eml`

  let stored
  try {
    const storage = await getStorage(context.env, account)
    stored = await storage.put(objectKey, mime, 'message/rfc822')
  } catch (error) {
    return fail(
      'Saving the sent copy failed',
      502,
      error instanceof Error ? error.message : 'Storage unavailable',
      'storage_failed',
    )
  }

  try {
    await relay.send({
      fromName: account.display_name,
      fromEmail: account.email,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject,
      text: input.text,
      html: input.html,
      attachments,
    })
    const row = await persistRelayMessage({
      env: context.env,
      account,
      id,
      messageId,
      to,
      cc,
      bcc,
      subject,
      snippet,
      bodyText: input.text,
      bodyHtml: input.html ?? null,
      sentAt: now.toISOString(),
      size: mime.byteLength,
      storageKey: stored.key,
      attachments: attachmentMeta,
      status: 'sent',
    })
    if (input.draftId) {
      await deleteDraftById(context.env, input.draftId).catch(() => undefined)
    }
    const warning = await copySentToImapAccount(context.env, account, mime, (promise) =>
      context.waitUntil(promise),
    )
    return json({ ok: true, message: relayMessageSummary(row, account), warning }, 201)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Invio fallito'
    await persistRelayMessage({
      env: context.env,
      account,
      id,
      messageId,
      to,
      cc,
      bcc,
      subject,
      snippet,
      bodyText: input.text,
      bodyHtml: input.html ?? null,
      sentAt: now.toISOString(),
      size: mime.byteLength,
      storageKey: stored.key,
      attachments: attachmentMeta,
      status: 'failed',
    })
    return json({ error: 'Send failed', code: 'message_send_failed', detail, messageId: id }, 502)
  }
}
