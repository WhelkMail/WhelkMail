import type { MailboxSyncState, SyncOverview } from '../../shared/types'

/**
 * Fingerprint of one folder's sync state.
 *
 * The list is refreshed when this string changes, so every field that can make
 * the D1 mirror gain or lose rows has to be part of it. `maxUid` alone is not
 * enough: while the backfill walks towards older messages `maxUid` stays the
 * same and only `minUid` (and `synced`) move, which is exactly the window where
 * the user is waiting for messages to appear.
 */
export function folderSyncSignature(state: MailboxSyncState): string {
  return [
    state.folder,
    state.maxUid,
    state.minUid,
    state.synced,
    state.total,
    state.backfillDone ? 1 : 0,
    state.status,
  ].join(':')
}

export function syncSignature(overview: SyncOverview): string {
  return overview.accounts
    .map(
      (account) =>
        `${account.accountId}:${account.folders.map(folderSyncSignature).join(',')}`,
    )
    .join('|')
}
