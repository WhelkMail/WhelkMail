import type { DraftPayload } from '../../../../shared/types'
import type { Env } from '../../../_lib/env'
import { fail, json } from '../../../_lib/http'
import { loadRaw } from '../../../_lib/mail/load'
import { bodyText, contentToBase64, parseFull } from '../../../_lib/mail/parse'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const loaded = await loadRaw(context.env, id, false)
  if (!loaded || loaded.folder !== 'draft') {
    return fail('Draft not found', 404, undefined, 'message_not_found')
  }
  const email = await parseFull(loaded.bytes)
  const addresses = (list: { address?: string }[] | undefined): string[] =>
    (list ?? []).map((item) => item.address ?? '').filter(Boolean)

  const draft: DraftPayload = {
    id,
    accountId: loaded.account.id,
    to: addresses(email.to),
    cc: addresses(email.cc),
    bcc: addresses(email.bcc),
    subject: email.subject ?? '',
    text: bodyText(email),
    html: email.html ?? null,
    attachments: (email.attachments ?? []).map((attachment) => ({
      filename: attachment.filename || 'allegato',
      contentType: attachment.mimeType || 'application/octet-stream',
      dataBase64: contentToBase64(attachment.content),
    })),
  }
  return json({ draft })
}
