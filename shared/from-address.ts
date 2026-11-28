import { type ForwarderVerdict, governedForwarded } from './forwarding'

/**
 * Sending from another address on a relay account's domain.
 *
 * A domain that forwards many addresses (shop@DOMAIN.IT, bank@DOMAIN.IT, ...)
 * to one mailbox needs replies to leave from the address each message was sent
 * to. A relay account with `relayAnyAddress` may do that, but only on its own
 * exact domain: subdomains and other domains are refused. The client picks the
 * address; the server checks it again before sending.
 */

/**
 * Addresses the send endpoint accepts: the same pattern as zod's email check
 * (`z.regexes.email`), which `sendSchema` applies to `fromEmail`. Copied so
 * the client doesn't need zod; a test keeps the two in step. An alias outside
 * it (shop=orders@DOMAIN.IT) can't be sent from, so it isn't offered.
 */
export const SENDABLE_ADDRESS =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/

const sendable = (email: string | null): string | null => (email && SENDABLE_ADDRESS.test(email) ? email : null)

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

export interface FromAccount {
  kind: string
  email: string
  relayAnyAddress: boolean
}

/** Whether `account` may send with `fromEmail` as its From address. */
export function canSendFrom(account: FromAccount, fromEmail: string): boolean {
  const from = fromEmail.trim().toLowerCase()
  if (from === account.email.trim().toLowerCase()) {
    return true
  }
  const domain = domainOf(account.email)
  return (
    account.kind === 'relay' &&
    account.relayAnyAddress &&
    domain !== '' &&
    domainOf(from) === domain
  )
}

export interface DomainAliasInput {
  /**
   * Addresses from the forwarding headers (`X-Forwarded-For`, `Delivered-To`,
   * `Received ... for`, ...), in header order: the topmost first.
   */
  forwarded: string[]
  /**
   * Domains the receiving server reports a passing DKIM signature for
   * (`verifiedDomains()`). Forwarding headers only count for these.
   */
  verifiedDomains: string[]
  /** To and Cc of the message. */
  recipients: string[]
  /**
   * Forwarder verdicts for the message (`MessageDetail.forwarding`). A domain a
   * verdict governs only trusts the forwarder's validated record.
   */
  forwarding?: ForwarderVerdict[]
  /** Domain of the sending account. */
  domain: string
  /**
   * Address of the mailbox that received the message. On a shared domain it
   * usually heads the headers (Delivered-To), so other addresses are preferred
   * and it's only used when it's the sole candidate.
   */
  receivingEmail?: string
}

/**
 * The address on `domain` that a message was sent to, or null.
 *
 * Forwarding headers are only read when the receiving server vouches for the
 * domain: a forwarder that signs with it (Cloudflare Email Routing does) leaves
 * a passing DKIM result, which mail delivered straight to the mailbox can't
 * have. Then every server a message passes through adds its headers above the
 * ones already there, so reading top-down and taking the first address on the
 * domain finds the forwarder's record before any forged copy further down.
 *
 * To/Cc are written by the sender, so they are only a fallback when no trusted
 * forwarding header names an address on the domain, and only when exactly one
 * of them is on it: with several there's no telling which one is ours.
 */
export function pickDomainAlias(input: DomainAliasInput): string | null {
  const domain = input.domain.trim().toLowerCase()
  if (!domain) {
    return null
  }
  const onDomain = (email: string): boolean => domainOf(email) === domain
  const receiving = input.receivingEmail?.trim().toLowerCase() ?? ''
  let receivingSeen = false
  if (input.verifiedDomains.some((verified) => verified.toLowerCase() === domain)) {
    const forwarded = governedForwarded(input.forwarded, input.forwarding ?? [], receiving)
    const onDomainForwarded = forwarded.map((email) => email.trim().toLowerCase()).filter(onDomain)
    receivingSeen = onDomainForwarded.includes(receiving)
    const alias = onDomainForwarded.find((email) => email !== receiving)
    if (alias) {
      // The forwarder's record wins even when it can't be sent from: falling
      // through to a lower header or To/Cc would pick a different address.
      return sendable(alias)
    }
  }
  const recipients = new Set(
    input.recipients.map((email) => email.trim().toLowerCase()).filter(onDomain),
  )
  receivingSeen ||= recipients.delete(receiving)
  if (recipients.size === 1) {
    return sendable([...recipients][0])
  }
  return recipients.size === 0 && receivingSeen ? sendable(receiving) : null
}

export interface ReplyAccountInput {
  /**
   * Accounts that can send, other than the one holding the message, in
   * account order. `anyAddress` marks a relay with `relayAnyAddress` on.
   */
  accounts: { id: string; email: string; anyAddress: boolean }[]
  /** Address of the account that received the message. */
  receivingEmail: string
  /** True for a message in Sent: its From is our own address. */
  sent: boolean
  /** True when the account holding the message is itself a relay. */
  receivingIsRelay?: boolean
  /** From of the message. */
  from: string
  forwarded: string[]
  verifiedDomains: string[]
  recipients: string[]
  /** Forwarder verdicts for the message, as in `DomainAliasInput`. */
  forwarding?: ForwarderVerdict[]
}

/**
 * Which account replies as the address a message was sent to, and as which
 * address: an account with exactly that address, or else a relay allowed to
 * send as any address on its domain. Both go through the same trust checks.
 *
 * - In Sent, the message's own From is the address to keep. To/Cc there are
 *   the recipients, not us. A relay's own Sent copy is answered by that relay,
 *   so no other account takes over.
 * - Otherwise the forwarding headers are read top-down, but only addresses on
 *   a domain the receiving server vouches for (`verifiedDomains()`), so a
 *   header the sender wrote on mail delivered straight to the inbox is
 *   ignored. The first one that resolves to an account wins.
 * - Failing that, To/Cc, which the sender writes, only count when they name
 *   exactly one address that resolves to an account, so neither account order
 *   nor an added Cc decides between two of them.
 * - An address that belongs to the receiving account itself stays with it:
 *   ordinary mail to me@DOMAIN.IT is answered by that account.
 *
 * An account with exactly the address takes priority over a domain relay.
 */
export function pickReplyAccount(input: ReplyAccountInput): { accountId: string; alias: string } | null {
  const receiving = input.receivingEmail.trim().toLowerCase()
  // `ambiguous` means two relays can send as the domain: choosing one would make
  // the reply depend on account order, so no alias is offered.
  const resolve = (
    address: string,
  ): { kind: 'exact' | 'relay'; accountId: string; alias: string | null } | { kind: 'ambiguous' } | null => {
    const exact = input.accounts.find((account) => account.email.trim().toLowerCase() === address)
    if (exact) {
      return { kind: 'exact', accountId: exact.id, alias: address }
    }
    const relays = input.accounts.filter(
      (account) => account.anyAddress && domainOf(account.email) === domainOf(address),
    )
    if (relays.length === 0) {
      return null
    }
    if (relays.length > 1) {
      return { kind: 'ambiguous' }
    }
    return { kind: 'relay', accountId: relays[0].id, alias: sendable(address) }
  }
  const result = (found: { accountId: string; alias: string | null } | null) =>
    found && found.alias && found.alias !== receiving ? { accountId: found.accountId, alias: found.alias } : null

  if (input.sent) {
    if (input.receivingIsRelay) {
      return null
    }
    const resolution = resolve(input.from.trim().toLowerCase())
    return resolution && resolution.kind !== 'ambiguous' ? result(resolution) : null
  }
  const verified = new Set(input.verifiedDomains.map((domain) => domain.toLowerCase()))
  for (const email of governedForwarded(input.forwarded, input.forwarding ?? [], receiving)) {
    const address = email.trim().toLowerCase()
    // The receiving mailbox's own address often heads the headers on a shared
    // domain (Delivered-To): look past it for the alias.
    if (address === receiving || !verified.has(domainOf(address))) {
      continue
    }
    const resolution = resolve(address)
    if (resolution?.kind === 'ambiguous') {
      // Two relays serve this domain: stop here rather than guessing or moving
      // on to a lower header that names a different address.
      return null
    }
    if (resolution) {
      // The forwarder's record wins even when it can't be sent from: falling
      // through to a lower header or To/Cc would pick a different address.
      return result(resolution)
    }
  }
  const candidates = new Set(
    input.recipients
      .map((email) => email.trim().toLowerCase())
      .filter((address) => {
        if (!address || address === receiving) {
          return false
        }
        const resolution = resolve(address)
        return Boolean(resolution && resolution.kind !== 'ambiguous')
      }),
  )
  const only = candidates.size === 1 ? resolve([...candidates][0]) : null
  return only && only.kind !== 'ambiguous' ? result(only) : null
}
