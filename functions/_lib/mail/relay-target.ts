import type { AccountRow } from '../db'
import { getAccountRow } from '../db'
import type { Env } from '../env'
import {
  encodeImapPointer,
  parseImapPointer,
  type ImapCopyPointer,
} from '../../../shared/relay-copy'
import { deleteMessageAt, fetchMessageAt, saveDraft, appendToSent } from './imap'
import { getStorage } from '../storage'

/**
 * Some deployments prefer a real mailbox over Drive/R2 for send-only accounts.
 * In that mode the sent copy (and the drafts) are appended to an IMAP account
 * and `messages.storage_key` holds a pointer (see `shared/relay-copy.ts`)
 * instead of an object-storage key.
 */
export { encodeImapPointer, parseImapPointer, type ImapCopyPointer }

/** The IMAP account that stores sent copies for a send-only account. */
export async function resolveCopyTarget(
  env: Env,
  account: AccountRow,
): Promise<AccountRow | null> {
  const id = account.sent_copy_account_id
  if (!id) {
    return null
  }
  const target = await getAccountRow(env, id)
  if (!target || target.kind !== 'imap' || !target.secret_enc) {
    return null
  }
  return target
}

/**
 * Append a copy to the target mailbox (`sent` or `draft`) and return the
 * storage key that points at it.
 */
export async function storeCopyInMailbox(
  env: Env,
  target: AccountRow,
  mime: Uint8Array,
  kind: 'sent' | 'draft',
): Promise<string> {
  const appended = kind === 'sent' ? await appendToSent(env, target, mime) : await saveDraft(env, target, mime)
  return encodeImapPointer({ accountId: target.id, folder: appended.folder, uid: appended.uid })
}

export async function loadCopyBytes(env: Env, pointer: ImapCopyPointer): Promise<Uint8Array | null> {
  const account = await getAccountRow(env, pointer.accountId)
  if (!account || account.kind !== 'imap') {
    return null
  }
  return fetchMessageAt(env, account, pointer.folder, pointer.uid)
}

/**
 * Remove a copy from the mailbox that holds it. Used when a draft is replaced
 * or deleted and when a sent message is deleted from the app.
 */
export async function deleteCopy(env: Env, pointer: ImapCopyPointer): Promise<void> {
  const account = await getAccountRow(env, pointer.accountId)
  if (!account || account.kind !== 'imap') {
    return
  }
  await deleteMessageAt(env, account, pointer.folder, pointer.uid)
}

/**
 * Remove whatever backs a relay message or draft: an IMAP copy, an R2 object or
 * a Drive file. Pointers are deleted from their mailbox, object keys from the
 * configured archive.
 */
export async function removeStoredCopy(
  env: Env,
  account: AccountRow,
  storageDriver: string,
  storageKey: string,
): Promise<void> {
  if (!storageKey) {
    return
  }
  const pointer = parseImapPointer(storageKey)
  if (pointer) {
    await deleteCopy(env, pointer)
    return
  }
  if (storageDriver === 'imap') {
    return
  }
  const storage = await getStorage(env, account)
  await storage.remove(storageKey)
}
