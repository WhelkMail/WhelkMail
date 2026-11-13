import type { AccountRow } from './db'
import type { Env } from './env'
import { loadRaw } from './mail/load'
import { bodyText, parseFull, toMailbox } from './mail/parse'
import { sendWithAccount } from './mail/smtp'
import { buildMime } from './mime'
import type { ImapMessageRow } from './sync'

const decoder = new TextDecoder()

async function logForward(
  env: Env,
  filterId: string,
  accountId: string,
  messageId: string,
  status: string,
  error: string | null = null,
): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO forward_log (id, filter_id, account_id, message_id, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(filter_id, message_id) DO UPDATE SET status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      filterId,
      accountId,
      messageId,
      status,
      error,
      now,
      now,
    )
    .run()
}

export async function forwardFilteredMessage(
  env: Env,
  account: AccountRow,
  filterId: string,
  recipients: string[],
  message: ImapMessageRow,
): Promise<string> {
  const existing = await env.DB.prepare(
    'SELECT status FROM forward_log WHERE filter_id = ? AND message_id = ?',
  )
    .bind(filterId, message.id)
    .first<{ status: string }>()
  if (existing?.status === 'sent') {
    return 'sent'
  }

  try {
    const loaded = await loadRaw(env, message.id)
    if (!loaded) {
      await logForward(env, filterId, account.id, message.id, 'failed', 'Original message not available')
      return 'failed'
    }
    const head = decoder.decode(loaded.bytes.slice(0, 8192)).toLowerCase()
    if (head.includes('x-whelkmail-forwarded:')) {
      await logForward(env, filterId, account.id, message.id, 'skipped', 'Message already forwarded')
      return 'skipped'
    }

    const email = await parseFull(loaded.bytes)
    const from = toMailbox(email.from)
    const subject = email.subject?.trim() || message.subject || '(nessun oggetto)'
    if (recipients.length === 0) {
      await logForward(env, filterId, account.id, message.id, 'failed', 'No recipients')
      return 'failed'
    }
    const originalText = bodyText(email).slice(0, 5000)
    const forwardedText = [
      '---------- Messaggio inoltrato ----------',
      `Da: ${from.name ? `${from.name} <${from.email}>` : from.email}`,
      `Data: ${email.date ?? message.sent_at}`,
      `Oggetto: ${subject}`,
      '',
      originalText,
    ].join('\n')
    const domain = account.email.split('@')[1] ?? 'whelkmail.local'
    const mime = buildMime({
      from: { name: account.display_name, email: account.email },
      to: recipients.map((recipient) => ({ email: recipient })),
      cc: [],
      bcc: [],
      subject: /^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`,
      text: forwardedText,
      attachments: [
        {
          filename: `forwarded-${message.uid}.eml`,
          contentType: 'message/rfc822',
          content: loaded.bytes,
        },
      ],
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      date: new Date(),
      headers: [`X-WhelkMail-Forwarded: ${filterId}`],
    })
    await sendWithAccount(env, account, mime, recipients)
    await logForward(env, filterId, account.id, message.id, 'sent')
    return 'sent'
  } catch (error) {
    await logForward(
      env,
      filterId,
      account.id,
      message.id,
      'failed',
      error instanceof Error ? error.message : String(error),
    )
    return 'failed'
  }
}
