import { parseImapPointer } from '../../../shared/relay-copy'

/**
 * Which objects an account deletion has to remove, grouped by the backend that
 * wrote them.
 *
 * Pure on purpose: the decision is easy to get wrong (a pointer is a message in
 * someone else's mailbox, a legacy archive row has no backend) and this way it
 * can be tested without D1 or IMAP.
 */
export interface PurgePlan {
  /** Object keys of relay copies (`messages.storage_key`). */
  copies: Map<string, Set<string>>
  /** Object keys of archived IMAP bodies (`imap_messages.archive_key`). */
  archives: Map<string, Set<string>>
}

/** Backends to try for rows archived before `archive_driver` existed. */
export const LEGACY_ARCHIVE_DRIVERS = ['drive', 'r2'] as const

export function planAccountPurge(
  copies: Array<{ driver: string | null; key: string | null }>,
  archives: Array<{ driver: string | null; key: string | null }>,
): PurgePlan {
  const plan: PurgePlan = { copies: new Map(), archives: new Map() }
  const add = (bucket: Map<string, Set<string>>, driver: string | null, key: string | null): void => {
    if (!driver || !key) {
      return
    }
    const keys = bucket.get(driver) ?? new Set<string>()
    keys.add(key)
    bucket.set(driver, keys)
  }

  for (const row of copies) {
    // A pointer refers to a message kept in an IMAP mailbox: deleting the
    // account must never remove mail from the provider.
    if (row.key && !parseImapPointer(row.key)) {
      add(plan.copies, row.driver, row.key)
    }
  }

  for (const row of archives) {
    if (!row.key) {
      continue
    }
    // Without a recorded driver there is no way to know which backend wrote the
    // object, so it is removed from both (the wrong attempt is a harmless no-op).
    for (const driver of row.driver ? [row.driver] : LEGACY_ARCHIVE_DRIVERS) {
      add(plan.archives, driver, row.key)
    }
  }

  return plan
}
