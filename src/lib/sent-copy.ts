/**
 * Pick the IMAP mailbox that stores the sent copies of a relay account.
 *
 * The onboarding form used to keep an empty selection while the dropdown showed
 * the first mailbox, so submitting an "append sent to another IMAP" account was
 * rejected with "choose an IMAP account" even though one appeared to be chosen.
 * Resolving the target in one place keeps what the user sees, the form state and
 * the value sent to the backend identical.
 */
export interface SentCopyTargetLike {
  id: string
}

export function resolveSentCopyTarget<T extends SentCopyTargetLike>(
  current: string | null | undefined,
  targets: T[],
): string {
  if (current && targets.some((target) => target.id === current)) {
    return current
  }
  return targets[0]?.id ?? ''
}
