import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareRelay } from '../functions/_lib/relay/cloudflare'
import { relayDomainMissing } from '../functions/_lib/relay/validation'
import { findRelayProvider } from '../shared/presets'
import type { RelayMessage } from '../functions/_lib/relay/types'

const message: RelayMessage = {
  fromName: 'Alerts',
  fromEmail: 'alerts@notifications.example.com',
  to: ['a@example.com', 'b@example.com'],
  cc: [],
  bcc: ['c@example.com'],
  subject: 'Hello',
  text: 'Body',
  attachments: [
    { filename: 'hi.txt', contentType: 'text/plain', content: new TextEncoder().encode('hi\n') },
  ],
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cloudflare REST relay', () => {
  it('maps the message onto the send API and returns the message id', async () => {
    const fetchMock = mockFetch(200, {
      success: true,
      errors: [],
      result: { message_id: '<id@example.com>', delivered: [], queued: ['a@example.com', 'b@example.com', 'c@example.com'] },
    })
    const result = await new CloudflareRelay('token', 'acct123').send(message)
    expect(result.providerMessageId).toBe('<id@example.com>')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/email/sending/send')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
    const body = JSON.parse(init.body as string)
    expect(body.from).toBe('"Alerts" <alerts@notifications.example.com>')
    expect(body.to).toEqual(['a@example.com', 'b@example.com'])
    expect(body.cc).toBeUndefined()
    expect(body.bcc).toEqual(['c@example.com'])
    expect(body.attachments).toEqual([
      { filename: 'hi.txt', type: 'text/plain', disposition: 'attachment', content: 'aGkK' },
    ])
  })

  it('surfaces Cloudflare error codes', async () => {
    mockFetch(403, {
      success: false,
      errors: [{ code: 10203, message: 'email.sending.error.email.sending_disabled' }],
      result: null,
    })
    await expect(new CloudflareRelay('token', 'acct').send(message)).rejects.toThrow(
      '10203 email.sending.error.email.sending_disabled',
    )
  })

  it('reports bounced and suppressed recipients as undelivered instead of failing', async () => {
    mockFetch(200, {
      success: true,
      result: {
        message_id: '<x>',
        delivered: [],
        queued: [],
        permanent_bounces: ['a@example.com'],
        suppressed_recipients: ['b@example.com'],
      },
    })
    await expect(new CloudflareRelay('token', 'acct').send(message)).resolves.toEqual({
      providerMessageId: '<x>',
      undelivered: ['a@example.com', 'b@example.com'],
    })

    mockFetch(200, { success: true, result: { message_id: '<y>', delivered: ['a@example.com'], queued: [] } })
    await expect(new CloudflareRelay('token', 'acct').send(message)).resolves.toEqual({ providerMessageId: '<y>' })
  })
})

describe('relay domain validation', () => {
  it('names the account ID for Cloudflare and the domain for Mailgun', async () => {
    const cloudflare = relayDomainMissing(findRelayProvider('cloudflare')!)
    expect(cloudflare.status).toBe(400)
    expect(await cloudflare.json()).toMatchObject({
      error: 'Cloudflare Email Service account ID is required',
      code: 'relay_account_id_required',
    })

    const mailgun = relayDomainMissing(findRelayProvider('mailgun')!)
    expect(await mailgun.json()).toMatchObject({
      error: 'Mailgun domain is required',
      code: 'relay_domain_required',
    })
  })
})
