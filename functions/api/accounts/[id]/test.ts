import { getAccountRow } from '../../../_lib/db'
import type { Env } from '../../../_lib/env'
import { fail, json } from '../../../_lib/http'
import { withImap } from '../../../_lib/mail/imap'
import { getMailCredentials } from '../../../_lib/mail/credentials'
import { SmtpConnection, type SmtpSecurity } from '../../../_lib/smtp/client'

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const row = await getAccountRow(context.env, id)
  if (!row) {
    return fail('Account not found', 404, undefined, 'account_not_found')
  }
  if (row.kind !== 'imap') {
    return json({ ok: true, kind: 'relay' })
  }

  const checks: Record<string, string> = {}
  try {
    const folders = await withImap(context.env, row, (connection) => connection.listFolders())
    checks.imap = `ok (${folders.length} cartelle)`
  } catch (error) {
    return fail(
      'IMAP connection failed',
      400,
      error instanceof Error ? error.message : 'error',
      'imap_failed',
    )
  }

  try {
    if (!row.smtp_host || !row.smtp_port || !row.smtp_security) {
      throw new Error('Configurazione SMTP mancante')
    }
    const credentials = await getMailCredentials(context.env, row)
    const connection = await SmtpConnection.open({
      host: row.smtp_host,
      port: row.smtp_port,
      security: row.smtp_security as SmtpSecurity,
    })
    try {
      await connection.authenticate(credentials)
      checks.smtp = 'ok'
    } finally {
      await connection.quit()
    }
  } catch (error) {
    return fail(
      'SMTP connection failed',
      400,
      error instanceof Error ? error.message : 'error',
      'smtp_failed',
    )
  }

  return json({ ok: true, kind: 'imap', checks })
}
