import type { Env } from '../../../_lib/env'
import { fail } from '../../../_lib/http'
import { loadRaw } from '../../../_lib/mail/load'
import { parseFull } from '../../../_lib/mail/parse'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const loaded = await loadRaw(context.env, id, false)
  if (!loaded) {
    return fail('Message not found', 404, undefined, 'message_not_found')
  }
  const email = await parseFull(loaded.bytes)
  const base = (email.subject || 'messaggio')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .trim()
    .slice(0, 80) || 'messaggio'
  const filename = `${base}.eml`
  const disposition = `attachment; filename="${base.replace(/"/g, "'")}.eml"; filename*=UTF-8''${encodeURIComponent(filename)}`
  return new Response(loaded.bytes, {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
}
