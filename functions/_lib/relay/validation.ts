import type { RelayProviderOption } from '../../../shared/presets'
import { fail } from '../http'
import type { RelayAdapter } from './types'

// Kept out of ./index so it can be imported (and tested) without pulling in
// the SMTP client, which depends on the Workers-only cloudflare:sockets.

/**
 * The 400 for a relay account saved without its relayDomain value, worded
 * for what the provider keeps there: a sending domain (Mailgun) or an
 * account ID (Cloudflare). Shared by account create and update, which both
 * used to hardcode "Mailgun domain is required".
 */
export function relayDomainMissing(provider: RelayProviderOption): Response {
  if (provider.domainLabel === 'accountId') {
    return fail(`${provider.label} account ID is required`, 400, undefined, 'relay_account_id_required')
  }
  return fail(`${provider.label} domain is required`, 400, undefined, 'relay_domain_required')
}

/**
 * The 400 for a message with more recipients (to + cc + bcc) than the relay
 * accepts, or null when it's within the limit or the relay has none.
 */
export function recipientLimitExceeded(
  relay: Pick<RelayAdapter, 'label' | 'maxRecipients'>,
  recipientCount: number,
): Response | null {
  if (relay.maxRecipients === undefined || recipientCount <= relay.maxRecipients) {
    return null
  }
  return fail(
    'Too many recipients for this relay',
    400,
    `${relay.label} allows at most ${relay.maxRecipients} recipients per message (to, cc and bcc combined); this message has ${recipientCount}.`,
    'too_many_recipients',
  )
}
