import type { Folder } from '../../../shared/types'
import { parseImapPointer } from '../../../shared/relay-copy'
import { toBase64Url } from '../crypto'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function imapMessageId(accountId: string, folder: Folder, uid: number): string {
  return `i_${accountId}.${toBase64Url(encoder.encode(folder))}.${uid}`
}

export function parseImapMessageId(
  id: string,
): { accountId: string; folder: Folder; uid: number } | null {
  if (!id.startsWith('i_')) {
    return null
  }
  const parts = id.slice(2).split('.')
  if (parts.length !== 3) {
    return null
  }
  const [accountId, folderEncoded, uidRaw] = parts
  const uid = Number(uidRaw)
  if (!accountId || !folderEncoded || !Number.isFinite(uid)) {
    return null
  }
  let folder = ''
  try {
    const normalized = folderEncoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
    folder = decoder.decode(Uint8Array.from(atob(normalized + padding), (char) => char.charCodeAt(0)))
  } catch {
    return null
  }
  if (folder !== 'inbox' && folder !== 'sent' && folder !== 'draft' && folder !== 'spam') {
    return null
  }
  return { accountId, folder, uid }
}

export function relayMessageId(id: string): string {
  return `r_${id}`
}

export function parseRelayMessageId(id: string): string | null {
  return id.startsWith('r_') ? id.slice(2) : null
}

/**
 * Mirror ids of the drafts that a relay account appends to another mailbox.
 *
 * A relay draft is listed from its `messages` row; the mailbox copy is mirrored
 * as a normal IMAP draft of the target account, so its id is filtered out of the
 * Drafts list and of draft searches. Non-pointer storage keys (Drive/R2 objects)
 * are ignored.
 */
export function draftMirrorIdsFromPointers(
  keys: Array<string | null | undefined>,
): string[] {
  const ids: string[] = []
  for (const key of keys) {
    const pointer = parseImapPointer(key)
    if (pointer) {
      ids.push(imapMessageId(pointer.accountId, 'draft', pointer.uid))
    }
  }
  return ids
}
