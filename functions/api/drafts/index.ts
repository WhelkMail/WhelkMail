import { draftSchema } from '../../../shared/schemas'
import type { AttachmentMeta } from '../../../shared/types'
import { fromBase64 } from '../../_lib/crypto'
import { getAccountRow, mailboxesFromAddresses, type MessageRow } from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { deleteDraftById } from '../../_lib/mail/drafts'
import { saveDraft } from '../../_lib/mail/imap'
import { imapMessageId, parseRelayMessageId } from '../../_lib/mail/ids'
import { buildMime, snippetOf } from '../../_lib/mime'
import { normalizeMessageId, threadKeyFor } from '../../_lib/mail/thread-key'
import { copyObjectKey, getStorage, rescueCandidates } from '../../_lib/storage'
import { removeStoredCopy, resolveCopyTarget, storeCopyInMailbox } from '../../_lib/mail/relay-target'
import { queueSync } from '../../_lib/sync'

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<unknown>(context.request)
  const parsed = draftSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid draft',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'draft_invalid',
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
  const to = mailboxesFromAddresses(input.to)
  const cc = mailboxesFromAddresses(input.cc)
  const bcc = mailboxesFromAddresses(input.bcc)
  const id = crypto.randomUUID()
  const domain = account.email.split('@')[1] ?? 'localhost'
  const messageId = `<draft-${id}@${domain}>`
  const now = new Date()
  const mime = buildMime({
    from: { name: account.display_name, email: account.email },
    to,
    cc,
    bcc,
    subject: input.subject.trim(),
    text: input.text,
    html: input.html,
    attachments,
    messageId,
    inReplyTo: input.inReplyTo ?? null,
    references: input.references ?? null,
    date: now,
  })
  const threadKey = threadKeyFor({
    messageId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    fallback: normalizeMessageId(messageId) || id,
  })

  if (account.kind === 'imap') {
    if (!account.secret_enc) {
      return fail('Account is not connected', 400, undefined, 'imap_not_connected')
    }
    let draftId: string
    try {
      const saved = await saveDraft(context.env, account, mime)
      draftId = imapMessageId(account.id, 'draft', saved.uid)
      if (input.draftId) {
        await deleteDraftById(context.env, input.draftId, (promise) => context.waitUntil(promise)).catch(
          () => undefined,
        )
      }
      await queueSync(context.env, account, 'draft', (promise) => context.waitUntil(promise)).catch(() => undefined)
    } catch (error) {
      return fail(
        'Saving the draft failed',
        502,
        error instanceof Error ? error.message : 'IMAP error',
        'draft_save_failed',
      )
    }
    return json({ ok: true, draftId })
  }

  if (account.storage_driver === 'r2' && !context.env.BUCKET) {
    return fail('R2 is not configured on this deployment', 400, undefined, 'r2_not_configured')
  }
  const existingId = input.draftId ? parseRelayMessageId(input.draftId) : null
  const relayId = existingId ?? id
  const copiesToMailbox = account.storage_driver === 'imap'
  const copyTarget = copiesToMailbox ? await resolveCopyTarget(context.env, account) : null
  if (copiesToMailbox && !copyTarget) {
    return fail(
      'Choose a connected IMAP account that stores the draft',
      400,
      undefined,
      'sent_copy_target_not_connected',
    )
  }
  let storageKey = ''
  let storageDriver: 'drive' | 'r2' | 'imap' = account.storage_driver === 'r2' ? 'r2' : 'drive'
  if (copyTarget) {
    storageDriver = 'imap'
    try {
      storageKey = await storeCopyInMailbox(context.env, copyTarget, mime, 'draft')
    } catch (error) {
      // Losing the draft because the mailbox rejected the APPEND would throw away
      // what the user typed: fall back to object storage when the deployment has
      // any, and record that driver on the row.
      let saved = false
      for (const candidate of rescueCandidates(context.env, account)) {
        try {
          const key = copyObjectKey(candidate.driver, account.id, 'draft', relayId)
          const stored = await candidate.storage.put(key, mime, 'message/rfc822')
          storageKey = stored.key
          storageDriver = candidate.driver
          saved = true
          break
        } catch {
          // Try the next backend before giving up on the draft.
        }
      }
      if (!saved) {
        return fail(
          'Saving the draft failed',
          502,
          error instanceof Error ? error.message : 'IMAP error',
          'draft_save_failed',
        )
      }
    }
  } else {
    const objectKey = copyObjectKey(storageDriver, account.id, 'draft', relayId)
    try {
      const storage = await getStorage(context.env, account)
      const stored = await storage.put(objectKey, mime, 'message/rfc822')
      storageKey = stored.key
    } catch (error) {
      return fail(
        'Saving the draft failed',
        502,
        error instanceof Error ? error.message : 'Storage unavailable',
        'draft_save_failed',
      )
    }
  }

  const nowIso = now.toISOString()
  const existing = existingId
    ? await context.env.DB.prepare('SELECT * FROM messages WHERE id = ?')
        .bind(existingId)
        .first<MessageRow>()
    : null

  if (existing) {
    if (existing.storage_key && existing.storage_key !== storageKey) {
      await removeStoredCopy(context.env, account, existing.storage_driver, existing.storage_key).catch(
        () => undefined,
      )
    }
    await context.env.DB.prepare(
      'UPDATE messages SET to_json = ?, cc_json = ?, bcc_json = ?, subject = ?, snippet = ?, body_text = ?, body_html = ?, sent_at = ?, size = ?, storage_driver = ?, storage_key = ?, attachments_json = ?, thread_key = ?, status = ?, folder = ? WHERE id = ?',
    )
      .bind(
        JSON.stringify(to),
        JSON.stringify(cc),
        JSON.stringify(bcc),
        input.subject.trim(),
        snippetOf(input.text),
        input.text,
        input.html ?? null,
        nowIso,
        mime.byteLength,
        storageDriver,
        storageKey,
        JSON.stringify(attachmentMeta),
        threadKey,
        'draft',
        'draft',
        relayId,
      )
      .run()
  } else {
    await context.env.DB.prepare(
      'INSERT INTO messages (id, account_id, folder, message_id, thread_key, from_name, from_email, to_json, cc_json, bcc_json, subject, snippet, body_text, body_html, sent_at, size, storage_driver, storage_key, attachments_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        relayId,
        account.id,
        'draft',
        messageId,
        threadKey,
        account.display_name,
        account.email,
        JSON.stringify(to),
        JSON.stringify(cc),
        JSON.stringify(bcc),
        input.subject.trim(),
        snippetOf(input.text),
        input.text,
        input.html ?? null,
        nowIso,
        mime.byteLength,
        storageDriver,
        storageKey,
        JSON.stringify(attachmentMeta),
        'draft',
        nowIso,
      )
      .run()
  }

  // The mirror of the destination folder is refreshed only now: the new copy has
  // been appended, the previous one expunged and the D1 row written, so the sync
  // sees the final state instead of a half-applied save.
  if (copyTarget) {
    await queueSync(context.env, copyTarget, 'draft', (promise) => context.waitUntil(promise)).catch(
      () => undefined,
    )
  }

  return json({ ok: true, draftId: `r_${relayId}` })
}
