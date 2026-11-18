import type { Email, Header } from 'postal-mime'
import type { ForwarderVerdict } from '../../../../shared/forwarding'
import { domainOf } from '../../../../shared/from-address'
import { type AuthResults, type ReceivedHeader } from './headers'

/**
 * Validating forwarding headers against the forwarder that wrote them.
 *
 * Two kinds of rule work together:
 *
 * - A **receiver** knows how one receiving provider (the server that holds the
 *   mailbox WhelkMail reads) records the hop it accepted the message from: its
 *   own `Received` header and its own `Authentication-Results`. Only headers
 *   the receiving server wrote can be trusted, because everything below them
 *   came from the connecting server.
 * - A **forwarder** knows what one forwarding service (Cloudflare Email
 *   Routing, …) writes when it passes a message on, and checks that evidence
 *   from the receiving server's hop downwards.
 *
 * A forwarder first decides whether a message shows signs of having passed
 * through it (`identify`). Those signs may be forged, so they only ever make
 * the checks stricter. An identified message is then validated (`validate`)
 * from the receiver's hop. When no receiver recognises the hop, the message
 * fails closed: the verdict carries no record, and no forwarding header in its
 * scope is trusted. Messages no forwarder identifies keep the existing
 * DKIM-based rules (`verifiedDomains()`).
 */

export interface ReceivingHop {
  /** Id of the receiver that recognised the hop. */
  receiver: string
  /** Index in `email.headers` of the receiving server's own `Received` header. */
  index: number
  received: ReceivedHeader
  /** The receiving server's own `Authentication-Results`, if it wrote one. */
  authResults: AuthResults | null
}

export interface Receiver {
  id: string
  /**
   * The hop at which this receiving provider accepted the message, or null when
   * the headers aren't this provider's or can't be read reliably.
   */
  findHop(headers: Header[]): ReceivingHop | null
}

export interface ForwarderContext {
  headers: Header[]
  /** The receiving server's hop, when a receiver recognised it. */
  hop: ReceivingHop | null
}

export interface ForwarderRecord {
  /** The address the forwarder received the message for. */
  alias: string
  /** The domain the forwarding hop is tied to, such as the envelope sender's domain. */
  domain: string
}

export interface Forwarder {
  id: string
  /**
   * Whether the message shows signs of this forwarder. Returns the domains whose
   * forwarding headers the forwarder's checks then govern (`null` for all of
   * them), or `undefined` when there are no signs.
   */
  identify(context: ForwarderContext): { scope: string[] | null } | undefined
  /**
   * The forwarder's record of the alias, when every check passes from the
   * receiving server's hop. Only called with a hop.
   */
  validate(context: ForwarderContext & { hop: ReceivingHop }): ForwarderRecord | null
}

/** Receiving providers with known hop formats. Added one per provider. */
export const RECEIVERS: Receiver[] = []

/** Forwarders with provider-specific checks. */
export const FORWARDERS: Forwarder[] = []

/** The receiving server's hop, from the first receiver that recognises it. */
export function findReceivingHop(headers: Header[], receivers: Receiver[] = RECEIVERS): ReceivingHop | null {
  for (const receiver of receivers) {
    const hop = receiver.findHop(headers)
    if (hop) {
      return hop
    }
  }
  return null
}

/**
 * One verdict per forwarder that identifies the message. An empty list means
 * no forwarder applies, and the existing rules are used unchanged.
 */
export function forwardingVerdicts(
  email: Pick<Email, 'headers'>,
  receivers: Receiver[] = RECEIVERS,
  forwarders: Forwarder[] = FORWARDERS,
): ForwarderVerdict[] {
  if (forwarders.length === 0) {
    return []
  }
  const headers = email.headers ?? []
  const hop = findReceivingHop(headers, receivers)
  const verdicts: ForwarderVerdict[] = []
  for (const forwarder of forwarders) {
    const identified = forwarder.identify({ headers, hop })
    if (!identified) {
      continue
    }
    const record = hop ? forwarder.validate({ headers, hop }) : null
    verdicts.push({
      forwarder: forwarder.id,
      scope: identified.scope?.map((domain) => domain.toLowerCase()) ?? null,
      record: record && isTied(record) ? { alias: record.alias.toLowerCase(), domain: record.domain.toLowerCase() } : null,
    })
  }
  return verdicts
}

/** A record only counts when its alias is on the domain the hop is tied to. */
function isTied(record: ForwarderRecord): boolean {
  const domain = record.domain.trim().toLowerCase()
  return domain !== '' && domainOf(record.alias) === domain
}
