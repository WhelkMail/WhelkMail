import type { AccountRow } from '../db'
import type { Env } from '../env'
import { DriveStorage } from './drive'
import { R2Storage } from './r2'
import type { StorageAdapter } from './types'

export async function getStorage(env: Env, row: AccountRow): Promise<StorageAdapter> {
  if (row.storage_driver === 'r2') {
    return new R2Storage(env)
  }
  if (row.storage_driver === 'imap') {
    throw new Error('This account keeps sent copies in an IMAP mailbox, not in object storage')
  }
  return new DriveStorage(env, row)
}

export function getImapArchiveStorage(env: Env, row: AccountRow): StorageAdapter | null {
  if (!row.archive_imap_bodies) {
    return null
  }
  if (row.imap_archive_driver === 'drive') {
    return row.drive_refresh_token_enc ? new DriveStorage(env, row) : null
  }
  return env.BUCKET ? new R2Storage(env) : null
}

export type { StorageAdapter } from './types'
