import type { AttachmentMeta, Folder, Mailbox, MessageDetail } from '../../../../shared/types'
import { getAccountRow, type MessageRow } from '../../../_lib/db'
import type { Env } from '../../../_lib/env'
import { fail, json } from '../../../_lib/http'
import { isSchemaError } from '../../../_lib/schema'
import { loadRaw } from '../../../_lib/mail/load'
import { markMessageSeen } from '../../../_lib/mail/imap'
import { parseImapMessageId, parseRelayMessageId } from '../../../_lib/mail/ids'
import {
  aliasAddresses,
  attachmentMeta,
  bodyText,
  dateOf,
  parseFull,
  toMailbox,
  toMailboxes,
} from '../../../_lib/mail/parse'

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function inlineCidImages(
  email: Awaited<ReturnType<typeof parseFull>>,
  html: string,
): string {
  const images = new Map<string, string>()
  let total = 0
  for (const attachment of email.attachments ?? []) {
    const contentType = attachment.mimeType ?? ''
    if (!attachment.contentId || !contentType.startsWith('image/')) {
      continue
    }
    const bytes = toBytes(attachment.content)
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
      continue
    }
    if (total + bytes.byteLength > 6 * 1024 * 1024) {
      continue
    }
    total += bytes.byteLength
    images.set(
      attachment.contentId.replace(/^<|>$/g, ''),
      `data:${contentType};base64,${bytesToBase64(bytes)}`,
    )
  }
  if (images.size === 0) {
    return html
  }
  return html.replace(/cid:([^"'\s)>]+)/gi, (match, cid: string) => {
    let key = cid
    try {
      key = decodeURIComponent(cid)
    } catch {
      // Keep the raw content id if it is not valid percent-encoding.
    }
    return images.get(key.replace(/[<>]/g, '')) ?? match
  })
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * Relay messages normally have a copy on Drive/R2 or in an IMAP mailbox. When
 * that copy is missing (a send that failed before the copy was written) the D1
 * row still holds the body, so the message opens instead of returning 404.
 */
async function relayDetail(env: Env, id: string): Promise<MessageDetail | null> {
  const relayId = parseRelayMessageId(id)
  if (!relayId) {
    return null
  }
  const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?')
    .bind(relayId)
    .first<MessageRow>()
  if (!row) {
    return null
  }
  const account = await getAccountRow(env, row.account_id)
  if (!account) {
    return null
  }
  const attachments = parseJson<AttachmentMeta[]>(row.attachments_json, [])
  let labelIds: string[] = []
  try {
    const labels = await env.DB.prepare('SELECT label_id FROM message_labels WHERE message_id = ?')
      .bind(id)
      .all<{ label_id: string }>()
    labelIds = labels.results.map((item) => item.label_id)
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
  return {
    id,
    accountId: account.id,
    accountEmail: account.email,
    accountName: account.display_name,
    folder: row.folder as Folder,
    from: { name: row.from_name, email: row.from_email },
    to: parseJson<Mailbox[]>(row.to_json, []),
    cc: parseJson<Mailbox[]>(row.cc_json, []),
    bcc: parseJson<Mailbox[]>(row.bcc_json, []),
    subject: row.subject,
    snippet: row.snippet,
    date: row.sent_at,
    unread: false,
    hasAttachments: attachments.length > 0,
    status: row.status === 'failed' ? 'failed' : row.status === 'draft' ? 'draft' : 'sent',
    aliasAddresses: [],
    text: row.body_text,
    html: row.body_html,
    attachments,
    size: row.size,
    labelIds,
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const startedAt = Date.now()
  const loaded = await loadRaw(context.env, id, true)
  if (!loaded) {
    const fallback = await relayDetail(context.env, id)
    if (fallback) {
      return json({ message: fallback })
    }
    return fail('Message not found', 404, undefined, 'message_not_found')
  }
  const loadDoneAt = Date.now()
  const email = await parseFull(loaded.bytes)
  const text = bodyText(email)
  const attachments = attachmentMeta(email)
  let labelIds: string[] = []
  try {
    const labels = await context.env.DB.prepare(
      'SELECT label_id FROM message_labels WHERE message_id = ?',
    )
      .bind(id)
      .all<{ label_id: string }>()
    labelIds = labels.results.map((row) => row.label_id)
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
  const detail: MessageDetail = {
    id,
    accountId: loaded.account.id,
    accountEmail: loaded.account.email,
    accountName: loaded.account.display_name,
    folder: loaded.folder,
    from: email.from ? toMailbox(email.from) : { name: null, email: '' },
    to: toMailboxes(email.to),
    cc: toMailboxes(email.cc),
    bcc: toMailboxes(email.bcc),
    subject: email.subject ?? '',
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    date: dateOf(email),
    unread: false,
    hasAttachments: attachments.length > 0,
    status: loaded.folder === 'draft' ? 'draft' : 'sent',
    aliasAddresses: aliasAddresses(email),
    text,
    html: email.html ? inlineCidImages(email, email.html) : null,
    attachments,
    size: loaded.bytes.byteLength,
    labelIds,
  }
  if (loaded.needsSeen) {
    const imapId = parseImapMessageId(id)
    if (imapId) {
      context.waitUntil(
        markMessageSeen(context.env, loaded.account, loaded.folder, imapId.uid).catch(
          () => undefined,
        ),
      )
    }
  }
  console.log(
    `[message] source=${loaded.source} load=${loadDoneAt - startedAt}ms parse=${Date.now() - loadDoneAt}ms size=${loaded.bytes.byteLength}`,
  )
  return json({ message: detail })
}
