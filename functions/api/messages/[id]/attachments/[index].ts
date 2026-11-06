import type { Env } from '../../../../_lib/env'
import { fail } from '../../../../_lib/http'
import { loadRaw } from '../../../../_lib/mail/load'
import { parseFull } from '../../../../_lib/mail/parse'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const index = Number(context.params.index)
  if (!Number.isInteger(index) || index < 0) {
    return fail('Invalid attachment', 400, undefined, 'invalid_request')
  }
  const loaded = await loadRaw(context.env, id, false)
  if (!loaded) {
    return fail('Message not found', 404, undefined, 'message_not_found')
  }
  const email = await parseFull(loaded.bytes)
  const attachment = email.attachments?.[index]
  if (!attachment) {
    return fail('Attachment not found', 404, undefined, 'attachment_not_found')
  }
  const filename = attachment.filename || `allegato-${index + 1}`
  const safe = filename.replace(/[\r\n"]/g, ' ').trim()
  const disposition = `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  return new Response(attachment.content, {
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
}
