import { describe, expect, it } from 'vitest'
import type { MailboxSyncState, SyncOverview } from '../shared/types'
import { folderSyncSignature, syncSignature } from '../src/lib/sync-signature'

function state(overrides: Partial<MailboxSyncState> = {}): MailboxSyncState {
  return {
    folder: 'inbox',
    uidValidity: 1,
    maxUid: 100,
    minUid: 60,
    backfillDone: false,
    status: 'partial',
    error: null,
    total: 400,
    synced: 40,
    lastSyncedAt: '2026-11-09T10:00:00.000Z',
    ...overrides,
  }
}

function overview(folders: MailboxSyncState[]): SyncOverview {
  return {
    accounts: [{ accountId: 'acc', email: 'a@b.c', syncing: true, folders }],
    syncing: true,
  }
}

describe('folder sync signature', () => {
  it('changes while the backfill adds older messages', () => {
    // maxUid is stable during a backfill: if the signature ignored minUid and
    // synced, the list would never refresh while older mail arrives.
    const before = folderSyncSignature(state())
    const after = folderSyncSignature(state({ minUid: 20, synced: 80 }))
    expect(after).not.toBe(before)
  })

  it('changes when the last sync flips to done', () => {
    const before = folderSyncSignature(state())
    const after = folderSyncSignature(state({ status: 'done', backfillDone: true }))
    expect(after).not.toBe(before)
  })

  it('changes when new mail arrives', () => {
    expect(folderSyncSignature(state({ maxUid: 101 }))).not.toBe(folderSyncSignature(state()))
  })

  it('is stable for an unchanged folder', () => {
    expect(folderSyncSignature(state())).toBe(folderSyncSignature(state()))
  })
})

describe('overview signature', () => {
  it('covers every account', () => {
    const one: SyncOverview = {
      accounts: [{ accountId: 'a', email: 'a@b.c', syncing: false, folders: [state()] }],
      syncing: false,
    }
    const two: SyncOverview = {
      accounts: [
        ...one.accounts,
        {
          accountId: 'b',
          email: 'b@b.c',
          syncing: false,
          folders: [state({ folder: 'sent', maxUid: 5 })],
        },
      ],
      syncing: false,
    }
    expect(syncSignature(two)).not.toBe(syncSignature(one))
  })

  it('produces a plain string for an installation without IMAP accounts', () => {
    expect(syncSignature({ accounts: [], syncing: false })).toBe('')
  })
})
