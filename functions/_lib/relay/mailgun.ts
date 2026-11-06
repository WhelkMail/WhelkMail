import { basicAuth, errorDetail, formatAddress, readJson } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

interface MailgunResponse {
  id?: string
  message?: string
}

export class MailgunRelay implements RelayAdapter {
  provider = 'mailgun'
  label = 'Mailgun'
  maxAttachmentBytes = 15 * 1024 * 1024
  private apiKey: string
  private domain: string
  private region: string

  constructor(apiKey: string, domain: string, region = 'us') {
    this.apiKey = apiKey
    this.domain = domain
    this.region = region
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    const host = this.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'
    const form = new FormData()
    form.append('from', formatAddress(message.fromName, message.fromEmail))
    form.append('to', message.to.join(','))
    if (message.cc.length > 0) {
      form.append('cc', message.cc.join(','))
    }
    if (message.bcc.length > 0) {
      form.append('bcc', message.bcc.join(','))
    }
    form.append('subject', message.subject)
    form.append('text', message.text)
    form.append('html', message.html ?? message.text)
    for (const attachment of message.attachments) {
      const blob = new Blob([attachment.content], { type: attachment.contentType })
      form.append('attachment', blob, attachment.filename)
    }
    const response = await fetch(`https://${host}/v3/${encodeURIComponent(this.domain)}/messages`, {
      method: 'POST',
      headers: { Authorization: basicAuth('api', this.apiKey) },
      body: form,
      signal: AbortSignal.timeout(45_000),
    })
    const data = (await readJson(response)) as MailgunResponse | null
    if (!response.ok) {
      throw new Error(`Invio Mailgun fallito: ${errorDetail(data, `HTTP ${response.status}`)}`)
    }
    return { providerMessageId: data?.id ?? null }
  }
}
