import type { AccountRow } from '../db'
import type { Env } from '../env'
import { DriveStorage } from './drive'
import { R2Storage } from './r2'
import type { StorageAdapter } from './types'

/**
 * Adapter for one storage driver. `null` means "no object storage": the `imap`
 * destination keeps copies in a mailbox and `provider` keeps them on the mail
 * server.
 */
export function storageForDriver(
  env: Env,
  row: AccountRow,
  driver: string | null | undefined,
): StorageAdapter | null {
  if (driver === 'r2') {
    return env.BUCKET ? new R2Storage(env) : null
  }
  if (driver === 'drive') {
    return new DriveStorage(env, row)
  }
  return null
}

/**
 * Storage for **new** objects, i.e. the destination currently configured on the
 * account. Reading or deleting an existing object must use the driver stored in
 * its row instead: an account can switch destination, and the objects written
 * with the previous one are still there.
 */
export async function getStorage(env: Env, row: AccountRow): Promise<StorageAdapter> {
  const storage = storageForDriver(env, row, row.storage_driver)
  if (!storage) {
    throw new Error(
      row.storage_driver === 'imap'
        ? 'This account keeps sent copies in an IMAP mailbox, not in object storage'
        : 'No object storage is configured for this account',
    )
  }
  return storage
}

/** Object key used for a relay copy. */
export function copyObjectKey(
  driver: 'drive' | 'r2',
  accountId: string,
  folder: 'sent' | 'draft',
  id: string,
): string {
  return driver === 'r2' ? `accounts/${accountId}/${folder}/${id}.eml` : `${folder}/${id}.eml`
}

/**
 * Emergency archive for the `imap` destination: when the APPEND fails there is
 * no copy anywhere, so the MIME would be lost and attachments or the raw view
 * would stop working. If the deployment has any object storage, the message is
 * written there instead and the row records that driver.
 */
export function rescueStorage(
  env: Env,
  row: AccountRow,
): { storage: StorageAdapter; driver: 'drive' | 'r2' } | null {
  if (row.drive_refresh_token_enc) {
    return { storage: new DriveStorage(env, row), driver: 'drive' }
  }
  if (env.BUCKET) {
    return { storage: new R2Storage(env), driver: 'r2' }
  }
  return null
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
