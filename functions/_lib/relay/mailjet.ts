import { toBase64 } from '../crypto'
import { basicAuth, errorDetail, readJson } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

interface MailjetMessage {
  Status?: string
  MessageID?: string
  Errors?: Record<string, string>
}

interface MailjetResponse {
  Messages?: MailjetMessage[]
}

export class MailjetRelay implements RelayAdapter {
  provider = 'mailjet'
  label = 'Mailjet'
  maxAttachmentBytes = 12 * 1024 * 1024
  private apiKey: string
  private apiSecret: string

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const payload = {
      Messages: [
        {
          From: { Email: message.fromEmail, Name: message.fromName },
          To: message.to.map((email) => ({ Email: email })),
          Cc: message.cc.map((email) => ({ Email: email })),
          Bcc: message.bcc.map((email) => ({ Email: email })),
          Subject: message.subject,
          TextPart: message.text,
          HTMLPart: message.html,
          Attachments: message.attachments.map((attachment) => ({
            ContentType: attachment.contentType,
            Filename: attachment.filename,
            Base64Content: toBase64(attachment.content),
          })),
        },
      ],
    }
    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        Authorization: basicAuth(this.apiKey, this.apiSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    const data = (await readJson(response)) as MailjetResponse | null
    const result = data?.Messages?.[0]
    if (!response.ok || result?.Status !== 'success') {
      const detail = result?.Errors
        ? Object.values(result.Errors).join('; ')
        : errorDetail(data, `HTTP ${response.status}`)
      throw new Error(`Invio Mailjet fallito: ${detail}`)
    }
    return { providerMessageId: result.MessageID ?? null }
  }
}
