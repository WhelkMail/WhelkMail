import { describe, expect, it } from 'vitest'
import type { AccountRow } from '../functions/_lib/db'
import { idExclusionClause } from '../functions/_lib/db'
import { ARCHIVE_UPDATE_SQL } from '../functions/_lib/mail/archive-update'
import type { Env } from '../functions/_lib/env'
import {
  archiveStorageCandidates,
  archiveStorageForDriver,
  copyObjectKey,
  rescueCandidates,
  storageForDriver,
} from '../functions/_lib/storage'

function env(withBucket: boolean): Env {
  return { BUCKET: withBucket ? {} : undefined } as unknown as Env
}

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acct-1',
    kind: 'relay',
    storage_driver: 'drive',
    drive_refresh_token_enc: null,
    ...overrides,
  } as AccountRow
}

describe('storageForDriver', () => {
  it('never returns an adapter for the mailbox or provider destinations', () => {
    expect(storageForDriver(env(true), row(), 'imap')).toBeNull()
    expect(storageForDriver(env(true), row(), 'provider')).toBeNull()
    expect(storageForDriver(env(true), row(), null)).toBeNull()
  })

  it('picks the adapter of the driver it is given, not the account one', () => {
    // The account switched to R2, but this row was written on Drive.
    const account = row({ storage_driver: 'r2' })
    expect(storageForDriver(env(true), account, 'drive')?.driver).toBe('drive')
    expect(storageForDriver(env(true), account, 'r2')?.driver).toBe('r2')
  })

  it('returns nothing when the requested backend is not configured', () => {
    expect(storageForDriver(env(false), row(), 'r2')).toBeNull()
  })
})

describe('rescueCandidates', () => {
  it('offers every configured backend, Drive first, so a failure can fall through', () => {
    expect(rescueCandidates(env(true), row({ drive_refresh_token_enc: 'enc' })).map((item) => item.driver))
      .toEqual(['drive', 'r2'])
    expect(rescueCandidates(env(true), row()).map((item) => item.driver)).toEqual(['r2'])
    expect(rescueCandidates(env(false), row())).toEqual([])
  })
})

describe('archive storage', () => {
  it('builds the adapter of the requested driver only', () => {
    expect(archiveStorageForDriver(env(true), row(), 'r2')?.driver).toBe('r2')
    expect(archiveStorageForDriver(env(true), row({ drive_refresh_token_enc: 'enc' }), 'drive')?.driver).toBe('drive')
    expect(archiveStorageForDriver(env(true), row(), 'drive')).toBeNull()
    expect(archiveStorageForDriver(env(false), row(), 'r2')).toBeNull()
  })

  it('tries the recorded driver first, then the other one', () => {
    const account = row({ imap_archive_driver: 'r2', drive_refresh_token_enc: 'enc' })
    expect(archiveStorageCandidates(env(true), account, 'drive').map((item) => item.driver)).toEqual([
      'drive',
      'r2',
    ])
    expect(archiveStorageCandidates(env(true), account, 'r2').map((item) => item.driver)).toEqual([
      'r2',
      'drive',
    ])
  })

  it('starts from the account setting when the row has no driver yet', () => {
    const account = row({ imap_archive_driver: 'drive', drive_refresh_token_enc: 'enc' })
    expect(archiveStorageCandidates(env(true), account, null).map((item) => item.driver)).toEqual([
      'drive',
      'r2',
    ])
  })
})

describe('copyObjectKey', () => {
  it('matches the keys used when the copy is written', () => {
    expect(copyObjectKey('drive', 'acct-1', 'sent', 'm1')).toBe('sent/m1.eml')
    expect(copyObjectKey('drive', 'acct-1', 'draft', 'm1')).toBe('draft/m1.eml')
    expect(copyObjectKey('r2', 'acct-1', 'sent', 'm1')).toBe('accounts/acct-1/sent/m1.eml')
    expect(copyObjectKey('r2', 'acct-1', 'draft', 'm1')).toBe('accounts/acct-1/draft/m1.eml')
  })
})

describe('idExclusionClause', () => {
  it('inlines ids without binding parameters (D1 caps them at 100)', () => {
    const clause = idExclusionClause('id', ['i_acct.ZHJhZnQ.7', 'i_acct2.ZGVSYWZ0.9'])
    expect(clause).toBe(" AND id NOT IN ('i_acct.ZHJhZnQ.7', 'i_acct2.ZGVSYWZ0.9')")
  })

  it('drops anything that is not a mirror id', () => {
    const clause = idExclusionClause('id', [
      "i_acct.ZHJhZnQ.1' OR 1=1 --",
      'sent/abc.eml',
      'imap:acct:Sent:3',
      'i_acct.ZHJhZnQ.1',
    ])
    expect(clause).toBe(" AND id NOT IN ('i_acct.ZHJhZnQ.1')")
  })

  it('returns an empty clause when there is nothing to hide', () => {
    expect(idExclusionClause('id', [])).toBe('')
    expect(idExclusionClause('id', ['drafts/x.eml'])).toBe('')
  })

  it('caps the list so the statement stays reasonable', () => {
    const ids = Array.from({ length: 620 }, (_, index) => `i_acct.ZHJhZnQ.${index + 1}`)
    expect(idExclusionClause('id', ids, 500).split(',').length).toBe(500)
  })
})

describe('archive update statement', () => {
  it('always records the backend next to the object key', () => {
    // Both sync paths use this constant: forgetting archive_driver in one of them
    // left rows that the archive cleanup could not attribute to a backend.
    expect(ARCHIVE_UPDATE_SQL).toContain('archive_key = ?')
    expect(ARCHIVE_UPDATE_SQL).toContain('archive_driver = ?')
    expect(ARCHIVE_UPDATE_SQL.match(/\?/g)).toHaveLength(3)
    expect(ARCHIVE_UPDATE_SQL).toContain('archived = 1')
  })
})
