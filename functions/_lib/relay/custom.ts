import { buildMime } from '../mime'
import { SmtpConnection, type SmtpSecurity } from '../smtp/client'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

export interface CustomSmtpConfig {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
}

export class CustomSmtpRelay implements RelayAdapter {
  provider = 'custom'
  label = 'SMTP'
  maxAttachmentBytes = 15 * 1024 * 1024
  private config: CustomSmtpConfig

  constructor(config: CustomSmtpConfig) {
    this.config = config
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const domain = message.fromEmail.split('@')[1] ?? 'localhost'
    const mime = buildMime({
      from: { name: message.fromName, email: message.fromEmail },
      to: message.to.map((email) => ({ email })),
      cc: message.cc.map((email) => ({ email })),
      bcc: message.bcc.map((email) => ({ email })),
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      date: new Date(),
      includeBcc: false,
    })
    const connection = await SmtpConnection.open({
      host: this.config.host,
      port: this.config.port,
      security: this.config.security,
    })
    try {
      await connection.authenticate({
        username: this.config.username,
        mode: 'password',
        password: this.config.password,
      })
      await connection.sendRaw(mime, message.fromEmail, [
        ...message.to,
        ...message.cc,
        ...message.bcc,
      ])
    } finally {
      await connection.quit()
    }
    return { providerMessageId: null }
  }
}
