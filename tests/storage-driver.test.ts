import { describe, expect, it } from 'vitest'
import type { AccountRow } from '../functions/_lib/db'
import { idExclusionClause } from '../functions/_lib/db'
import type { Env } from '../functions/_lib/env'
import {
  copyObjectKey,
  rescueStorage,
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

describe('rescueStorage', () => {
  it('prefers a connected Drive, then R2', () => {
    expect(rescueStorage(env(true), row({ drive_refresh_token_enc: 'enc' }))?.driver).toBe('drive')
    expect(rescueStorage(env(true), row())?.driver).toBe('r2')
    expect(rescueStorage(env(false), row())).toBeNull()
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
