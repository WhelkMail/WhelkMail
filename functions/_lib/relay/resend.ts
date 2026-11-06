import { toBase64 } from '../crypto'
import { errorDetail, formatAddress, readJson } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

interface ResendResponse {
  id?: string
}

export class ResendRelay implements RelayAdapter {
  provider = 'resend'
  label = 'Resend'
  maxAttachmentBytes = 15 * 1024 * 1024
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const payload = {
      from: formatAddress(message.fromName, message.fromEmail),
      to: message.to,
      cc: message.cc.length > 0 ? message.cc : undefined,
      bcc: message.bcc.length > 0 ? message.bcc : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: toBase64(attachment.content),
      })),
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    const data = (await readJson(response)) as ResendResponse | null
    if (!response.ok) {
      throw new Error(`Invio Resend fallito: ${errorDetail(data, `HTTP ${response.status}`)}`)
    }
    return { providerMessageId: data?.id ?? null }
  }
}
