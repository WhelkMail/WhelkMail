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
export function rescueCandidates(
  env: Env,
  row: AccountRow,
): { storage: StorageAdapter; driver: 'drive' | 'r2' }[] {
  const candidates: { storage: StorageAdapter; driver: 'drive' | 'r2' }[] = []
  if (row.drive_refresh_token_enc) {
    candidates.push({ storage: new DriveStorage(env, row), driver: 'drive' })
  }
  if (env.BUCKET) {
    candidates.push({ storage: new R2Storage(env), driver: 'r2' })
  }
  return candidates
}

/** Adapter for one archive driver of an IMAP account. */
export function archiveStorageForDriver(
  env: Env,
  row: AccountRow,
  driver: string | null | undefined,
): StorageAdapter | null {
  if (driver === 'r2') {
    return env.BUCKET ? new R2Storage(env) : null
  }
  if (driver === 'drive') {
    return row.drive_refresh_token_enc ? new DriveStorage(env, row) : null
  }
  return null
}

/**
 * Storage for **new** archives, i.e. the destination currently configured on the
 * account. Reading or deleting an archived message must use the driver stored in
 * its row: the account can switch between R2 and Drive, and the objects written
 * earlier stay where they were.
 */
export function getImapArchiveStorage(env: Env, row: AccountRow): StorageAdapter | null {
  if (!row.archive_imap_bodies) {
    return null
  }
  return archiveStorageForDriver(env, row, row.imap_archive_driver)
}

/**
 * Backends to try for an archived body: the one recorded on the row first, then
 * the other configured backend. Rows archived before the driver was recorded
 * have no value, so both are attempted (at most two requests).
 */
export function archiveStorageCandidates(
  env: Env,
  row: AccountRow,
  driver: string | null | undefined,
): StorageAdapter[] {
  const preferred = driver === 'drive' || driver === 'r2' ? driver : row.imap_archive_driver
  const order: ('drive' | 'r2')[] = preferred === 'drive' ? ['drive', 'r2'] : ['r2', 'drive']
  const candidates: StorageAdapter[] = []
  for (const candidate of order) {
    const storage = archiveStorageForDriver(env, row, candidate)
    if (storage && !candidates.some((item) => item.driver === storage.driver)) {
      candidates.push(storage)
    }
  }
  return candidates
}

export type { StorageAdapter } from './types'
