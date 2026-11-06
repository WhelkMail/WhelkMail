import { toBase64 } from '../crypto'
import { errorDetail, readJson } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

interface SendGridError {
  errors?: { message?: string }[]
}

export class SendGridRelay implements RelayAdapter {
  provider = 'sendgrid'
  label = 'SendGrid'
  maxAttachmentBytes = 15 * 1024 * 1024
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const personalization: Record<string, unknown> = {
      to: message.to.map((email) => ({ email })),
    }
    if (message.cc.length > 0) {
      personalization.cc = message.cc.map((email) => ({ email }))
    }
    if (message.bcc.length > 0) {
      personalization.bcc = message.bcc.map((email) => ({ email }))
    }
    const payload = {
      personalizations: [personalization],
      from: { email: message.fromEmail, name: message.fromName },
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
      ],
      attachments: message.attachments.map((attachment) => ({
        content: toBase64(attachment.content),
        filename: attachment.filename,
        type: attachment.contentType,
        disposition: 'attachment',
      })),
    }
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) {
      const data = (await readJson(response)) as SendGridError | null
      const detail =
        data?.errors
          ?.map((item) => item.message)
          .filter(Boolean)
          .join('; ') ?? errorDetail(data, `HTTP ${response.status}`)
      throw new Error(`Invio SendGrid fallito: ${detail}`)
    }
    return { providerMessageId: response.headers.get('X-Message-Id') }
  }
}
