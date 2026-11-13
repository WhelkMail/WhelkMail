import { toBase64 } from '../crypto'
import { errorDetail, formatAddress, readJson } from './shared'
import type { RelayAdapter, RelayMessage, RelayResult } from './types'

/**
 * Relay through Cloudflare Email Service's REST API.
 *
 * Per-account settings:
 * - API key: an account API token with the "Email Sending: Edit" permission.
 * - Domain field (`relay_domain`): the Cloudflare account ID, which is part
 *   of the URL. The preset labels this field "Account ID" (`domainLabel`).
 *
 * The sender's domain must be onboarded to Email Sending in that account,
 * otherwise Cloudflare answers 403 with code 10203.
 *
 * Cloudflare's SMTP endpoint can't be used through the custom SMTP relay
 * instead: Workers refuse TCP sockets to Cloudflare's own IP ranges.
 *
 * Docs: https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 */

/** The parts of Cloudflare's response this relay reads. */
interface CloudflareSendResponse {
  success?: boolean
  errors?: { code?: number; message?: string }[]
  result?: {
    message_id?: string
    // Each recipient is listed under one of: delivered, queued,
    // permanent_bounces or suppressed_recipients.
    permanent_bounces?: string[]
    suppressed_recipients?: string[]
  } | null
}

export class CloudflareRelay implements RelayAdapter {
  provider = 'cloudflare'
  label = 'Cloudflare Email Service'
  // Cloudflare's limit is 25 MiB for the whole encoded message; base64 makes
  // attachments about a third larger, so 15 MiB of raw files stays well under.
  maxAttachmentBytes = 15 * 1024 * 1024
  private apiToken: string
  private accountId: string

  constructor(apiToken: string, accountId: string) {
    this.apiToken = apiToken
    this.accountId = accountId
  }

  async send(message: RelayMessage): Promise<RelayResult> {
    // Same request shape as Resend: plain address lists, base64 attachments.
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
        type: attachment.contentType,
        disposition: 'attachment',
        content: toBase64(attachment.content),
      })),
    }
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/email/sending/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      },
    )
    const data = (await readJson(response)) as CloudflareSendResponse | null
    if (!response.ok || !data?.success) {
      // Errors arrive as a list of { code, message }, e.g.
      // "10203 email.sending.error.email.sending_disabled".
      const detail =
        data?.errors?.map((error) => `${error.code ?? ''} ${error.message ?? ''}`.trim()).join('; ') ||
        errorDetail(data, `HTTP ${response.status}`)
      throw new Error(`Cloudflare send failed: ${detail}`)
    }
    // The message was accepted. Recipients that bounced permanently or are on
    // the suppression list don't fail the send: they are returned so the UI
    // can show "Sent, but these addresses were not delivered: ...".
    const undelivered = [
      ...(data.result?.permanent_bounces ?? []),
      ...(data.result?.suppressed_recipients ?? []),
    ]
    return {
      providerMessageId: data.result?.message_id ?? null,
      ...(undelivered.length > 0 ? { undelivered } : {}),
    }
  }
}
