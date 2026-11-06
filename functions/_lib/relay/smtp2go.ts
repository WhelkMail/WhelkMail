import { toBase64 } from '../crypto'
import { errorDetail, formatAddress, readJson } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

interface Smtp2GoResponse {
  data?: {
    email_id?: string
    succeeded?: number
    failures?: string[]
    error?: string
  }
}

export class Smtp2GoRelay implements RelayAdapter {
  provider = 'smtp2go'
  label = 'SMTP2GO'
  maxAttachmentBytes = 15 * 1024 * 1024
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const payload = {
      api_key: this.apiKey,
      sender: formatAddress(message.fromName, message.fromEmail),
      to: [...message.to, ...message.cc, ...message.bcc],
      subject: message.subject,
      text_body: message.text,
      html_body: message.html ?? message.text,
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimetype: attachment.contentType,
        fileblob: toBase64(attachment.content),
      })),
    }
    const response = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    const data = (await readJson(response)) as Smtp2GoResponse | null
    if (!response.ok || !data?.data || data.data.succeeded !== 1) {
      const detail = data?.data?.failures?.join('; ') ?? data?.data?.error ?? errorDetail(data, `HTTP ${response.status}`)
      throw new Error(`Invio SMTP2GO fallito: ${detail}`)
    }
    return { providerMessageId: data.data.email_id ?? null }
  }
}
