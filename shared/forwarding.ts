/**
 * Forwarder verdicts, as the server computes them (`forwardingVerdicts()` in
 * `functions/_lib/mail/forwarding`) and the reply alias pickers apply them.
 */

export interface ForwarderVerdict {
  /** Forwarder id, such as `cloudflare`. */
  forwarder: string
  /**
   * Domains whose forwarding headers this verdict governs, lower case, or null
   * for every domain.
   */
  scope: string[] | null
  /**
   * The forwarder's validated record of the alias, or null when validation
   * failed or couldn't run. Null means no forwarding header in scope is trusted.
   */
  record: { alias: string; domain: string } | null
}

const domainOf = (email: string): string => {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

/**
 * The forwarding addresses that are left once the forwarder verdicts are
 * applied, still in header order.
 *
 * An address on a domain that a verdict governs is kept only when every
 * governing verdict has a validated record of exactly that address. So once a
 * forwarder identifies a message, a lower header on the domain can't be
 * trusted on its own, even when the domain passes DKIM, and a failed
 * validation trusts none. The receiving mailbox's own address is left as it
 * is: the pickers handle it themselves. Without verdicts the list is unchanged.
 */
export function governedForwarded(forwarded: string[], verdicts: ForwarderVerdict[], receivingEmail = ''): string[] {
  if (verdicts.length === 0) {
    return forwarded
  }
  const receiving = receivingEmail.trim().toLowerCase()
  return forwarded.filter((email) => {
    const address = email.trim().toLowerCase()
    if (address === receiving) {
      return true
    }
    const domain = domainOf(address)
    const governing = verdicts.filter((verdict) => verdict.scope === null || verdict.scope.includes(domain))
    return governing.every((verdict) => verdict.record?.alias === address)
  })
}
