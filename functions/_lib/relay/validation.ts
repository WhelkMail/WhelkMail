import type { RelayProviderOption } from '../../../shared/presets'
import { fail } from '../http'

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
