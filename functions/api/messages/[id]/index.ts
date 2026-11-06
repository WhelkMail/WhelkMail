import type { MessageDetail } from '../../../../shared/types'
import type { Env } from '../../../_lib/env'
import { fail, json } from '../../../_lib/http'
import { isSchemaError } from '../../../_lib/schema'
import { loadRaw } from '../../../_lib/mail/load'
import {
  attachmentMeta,
  bodyText,
  dateOf,
  parseFull,
  toMailbox,
  toMailboxes,
} from '../../../_lib/mail/parse'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const loaded = await loadRaw(context.env, id, true)
  if (!loaded) {
    return fail('Message not found', 404, undefined, 'message_not_found')
  }
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
    text,
    html: email.html ?? null,
    attachments,
    size: loaded.bytes.byteLength,
    labelIds,
  }
  return json({ message: detail })
}
