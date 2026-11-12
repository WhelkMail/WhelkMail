/**
 * Pointer to a copy of a relay message kept in an IMAP mailbox instead of an
 * object archive. Stored in `messages.storage_key`.
 *
 * Format: `imap:<accountId>:<encodedFolder>:<uid>`
 * `accountId` is a UUID (no colons) and the folder is percent-encoded, so the
 * parts can always be split on `:`.
 */
const POINTER_PREFIX = 'imap:'

export interface ImapCopyPointer {
  accountId: string
  folder: string
  uid: number
}

export function encodeImapPointer(pointer: ImapCopyPointer): string {
  return `${POINTER_PREFIX}${pointer.accountId}:${encodeURIComponent(pointer.folder)}:${pointer.uid}`
}

export function parseImapPointer(key: string | null | undefined): ImapCopyPointer | null {
  if (!key || !key.startsWith(POINTER_PREFIX)) {
    return null
  }
  const parts = key.slice(POINTER_PREFIX.length).split(':')
  if (parts.length !== 3) {
    return null
  }
  const [accountId, folder, uidRaw] = parts
  const uid = Number(uidRaw)
  if (!accountId || !folder || !Number.isInteger(uid) || uid <= 0) {
    return null
  }
  try {
    return { accountId, folder: decodeURIComponent(folder), uid }
  } catch {
    return null
  }
}
