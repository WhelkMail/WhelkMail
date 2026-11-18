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
