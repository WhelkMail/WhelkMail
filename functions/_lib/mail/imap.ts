import type { Folder } from '../../../shared/types'
import type { AccountRow } from '../db'
import type { Env } from '../env'
import { ImapConnection, type ImapConfig, type ImapHeader, type ImapSecurity } from '../imap/client'
import { getMailCredentials } from './credentials'

function configOf(account: AccountRow): ImapConfig {
  if (!account.imap_host || !account.imap_port || !account.imap_security) {
    throw new Error('IMAP configuration is missing')
  }
  return {
    host: account.imap_host,
    port: account.imap_port,
    security: account.imap_security as ImapSecurity,
  }
}

export async function withImap<T>(
  env: Env,
  account: AccountRow,
  handler: (connection: ImapConnection) => Promise<T>,
): Promise<T> {
  const credentials = await getMailCredentials(env, account)
  const connection = await ImapConnection.open(configOf(account))
  try {
    if (credentials.mode === 'oauth2') {
      await connection.authenticateXoauth2(credentials.username, credentials.accessToken ?? '')
    } else {
      await connection.login(credentials.username, credentials.password ?? '')
    }
    return await handler(connection)
  } finally {
    await connection.logout()
  }
}

async function resolveSpecialFolder(
  connection: ImapConnection,
  flag: string,
  fallback: string,
  namePattern?: RegExp,
): Promise<string> {
  try {
    const folders = await connection.listFolders()
    const special = folders.find((folder) =>
      folder.flags.some((item) => item.toLowerCase() === flag.toLowerCase()),
    )
    if (special) {
      return special.name
    }
    if (namePattern) {
      const named = folders.find((folder) => namePattern.test(folder.name))
      if (named) {
        return named.name
      }
    }
  } catch {
    // fall back
  }
  return fallback
}

async function persistFolder(
  env: Env,
  account: AccountRow,
  field: 'sent_folder' | 'drafts_folder' | 'spam_folder',
  value: string,
): Promise<void> {
  const current =
    field === 'sent_folder'
      ? account.sent_folder
      : field === 'drafts_folder'
        ? account.drafts_folder
        : account.spam_folder
  if (current === value) {
    return
  }
  try {
    await env.DB.prepare(`UPDATE accounts SET ${field} = ? WHERE id = ?`)
      .bind(value, account.id)
      .run()
    if (field === 'sent_folder') {
      account.sent_folder = value
    } else if (field === 'drafts_folder') {
      account.drafts_folder = value
    } else {
      account.spam_folder = value
    }
  } catch {
    // Folder resolution must keep working even if the schema is outdated.
  }
}

export async function resolveSentFolder(
  connection: ImapConnection,
  account: AccountRow,
  env?: Env,
): Promise<string> {
  if (account.sent_folder && account.sent_folder !== 'Sent') {
    return account.sent_folder
  }
  const resolved = await resolveSpecialFolder(
    connection,
    '\\Sent',
    account.sent_folder || 'Sent',
    /(^|[./])(sent|sent items|sent mail|sent messages|inviati|inviate|invio|posta inviata|inviata)$/i,
  )
  if (env) {
    await persistFolder(env, account, 'sent_folder', resolved)
  }
  return resolved
}

export async function resolveDraftsFolder(
  connection: ImapConnection,
  account?: AccountRow,
  env?: Env,
): Promise<string> {
  if (account?.drafts_folder) {
    return account.drafts_folder
  }
  const resolved = await resolveSpecialFolder(
    connection,
    '\\Drafts',
    account?.drafts_folder || 'Drafts',
    /(^|[./])(draft|drafts|draft messages|bozza|bozze)$/i,
  )
  if (env && account) {
    await persistFolder(env, account, 'drafts_folder', resolved)
  }
  return resolved
}

export async function resolveSpamFolder(
  connection: ImapConnection,
  account?: AccountRow,
  env?: Env,
): Promise<string> {
  if (account?.spam_folder) {
    return account.spam_folder
  }
  const resolved = await resolveSpecialFolder(
    connection,
    '\\Junk',
    account?.spam_folder || 'Spam',
    /(^|[./])(spam|junk|junk e-?mail|bulk mail|posta indesiderata|indesiderata|spazzatura)$/i,
  )
  if (env && account) {
    await persistFolder(env, account, 'spam_folder', resolved)
  }
  return resolved
}

export async function resolveTrashFolder(connection: ImapConnection): Promise<string> {
  return resolveSpecialFolder(
    connection,
    '\\Trash',
    'Trash',
    /(^|[./])(trash|deleted items|deleted messages|bin|cestino|posta eliminata|eliminati)$/i,
  )
}

export const MISSING_FOLDER = /TRYCREATE|NONEXISTENT|doesn't exist|does not exist|Mailbox doesn't exist/i

function uniqueFolders(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function folderCandidates(preferred: string, kind: 'sent' | 'draft'): string[] {
  const names =
    kind === 'sent'
      ? [
          preferred,
          `INBOX.${preferred}`,
          `INBOX/${preferred}`,
          'Sent',
          'INBOX.Sent',
          'INBOX/Sent',
          'Sent Items',
          'INBOX.Sent Items',
          'Sent Mail',
          'INBOX.Sent Mail',
          'Sent Messages',
          'INBOX.Sent Messages',
          'Posta inviata',
          'INBOX.Posta inviata',
          'Inviati',
          'INBOX.Inviati',
          'Inviate',
          'INBOX.Inviate',
        ]
      : [
          preferred,
          `INBOX.${preferred}`,
          `INBOX/${preferred}`,
          'Drafts',
          'INBOX.Drafts',
          'INBOX/Drafts',
          'Bozze',
          'INBOX.Bozze',
          'Bozza',
          'INBOX.Bozza',
          'Draft',
          'INBOX.Draft',
        ]
  return uniqueFolders(names)
}

async function appendWithCreate(
  connection: ImapConnection,
  preferred: string,
  message: Uint8Array,
  flags: string,
  kind: 'sent' | 'draft',
): Promise<{ uid: number | null; folder: string }> {
  let lastError: unknown = null
  for (const folder of folderCandidates(preferred, kind)) {
    try {
      const result = await connection.append(folder, message, flags)
      return { uid: result.uid, folder }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (!MISSING_FOLDER.test(detail)) {
        throw error
      }
      lastError = error
      try {
        await connection.create(folder)
      } catch {
        // It may already exist or the server may not allow CREATE; retry anyway.
      }
      try {
        const result = await connection.append(folder, message, flags)
        return { uid: result.uid, folder }
      } catch (retryError) {
        const retryDetail = retryError instanceof Error ? retryError.message : String(retryError)
        if (!MISSING_FOLDER.test(retryDetail)) {
          throw retryError
        }
        lastError = retryError
      }
    }
  }
  let available = ''
  try {
    available = (await connection.listFolders())
      .slice(0, 30)
      .map((folder) => folder.name)
      .join(', ')
  } catch {
    // ignore
  }
  const detail = lastError instanceof Error ? lastError.message : 'Folder not available'
  throw new Error(
    available ? `${detail} | Available folders: ${available}` : detail,
  )
}

async function targetFolder(
  env: Env,
  connection: ImapConnection,
  account: AccountRow,
  folder: Folder,
): Promise<string> {
  if (folder === 'inbox') {
    return 'INBOX'
  }
  if (folder === 'sent') {
    return resolveSentFolder(connection, account, env)
  }
  if (folder === 'spam') {
    return resolveSpamFolder(connection, account, env)
  }
  return resolveDraftsFolder(connection, account, env)
}

export async function resolveFolderName(
  env: Env,
  connection: ImapConnection,
  account: AccountRow,
  folder: Folder,
): Promise<string> {
  return targetFolder(env, connection, account, folder)
}

async function selectForRead(
  connection: ImapConnection,
  folder: string,
  allowCreate: boolean,
): Promise<{ uidNext: number | null; exists: number | null } | null> {
  try {
    return await connection.selectWithDetails(folder)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (!MISSING_FOLDER.test(detail)) {
      throw error
    }
    if (!allowCreate) {
      throw error
    }
    try {
      await connection.create(folder)
    } catch {
      // ignore; try selecting again in case it already exists
    }
    try {
      return await connection.selectWithDetails(folder)
    } catch {
      return null
    }
  }
}

export async function listFolder(
  env: Env,
  account: AccountRow,
  folder: Folder,
  limit = 30,
): Promise<ImapHeader[]> {
  return withImap(env, account, async (connection) => {
    const target = await targetFolder(env, connection, account, folder)
    const selected = await selectForRead(connection, target, folder !== 'inbox')
    if (!selected) {
      return []
    }
    let uids = await connection.searchRecentUids(limit, selected.uidNext)
    if (uids.length === 0 && (selected.exists ?? 1) > 0) {
      uids = (await connection.searchAll()).slice(-limit)
    }
    return connection.fetchHeaders(uids)
  })
}

export async function listFolderByUids(
  env: Env,
  account: AccountRow,
  folder: Folder,
  uids: number[],
): Promise<ImapHeader[]> {
  if (uids.length === 0) {
    return []
  }
  return withImap(env, account, async (connection) => {
    const target = await targetFolder(env, connection, account, folder)
    const selected = await selectForRead(connection, target, false)
    if (!selected) {
      return []
    }
    return connection.fetchHeaders(uids)
  })
}

export async function fetchMessage(
  env: Env,
  account: AccountRow,
  folder: Folder,
  uid: number,
  markRead = false,
): Promise<Uint8Array> {
  return withImap(env, account, async (connection) => {
    const target = await targetFolder(env, connection, account, folder)
    await connection.select(target)
    return connection.fetchFull(uid, markRead && (folder === 'inbox' || folder === 'spam'))
  })
}

export async function markMessageSeen(
  env: Env,
  account: AccountRow,
  folder: Folder,
  uid: number,
): Promise<void> {
  await withImap(env, account, async (connection) => {
    const target = await targetFolder(env, connection, account, folder)
    await connection.select(target)
    await connection.markSeen(uid)
  })
}

export async function appendToSent(
  env: Env,
  account: AccountRow,
  message: Uint8Array,
): Promise<{ folder: string; uid: number }> {
  return withImap(env, account, async (connection) => {
    const folder = await resolveSentFolder(connection, account, env)
    const result = await appendWithCreate(connection, folder, message, '(\\Seen)', 'sent')
    const uid = await appendedUid(connection, result.folder, result.uid)
    return { folder: result.folder, uid }
  })
}

export async function saveDraft(
  env: Env,
  account: AccountRow,
  message: Uint8Array,
): Promise<{ folder: string; uid: number }> {
  return withImap(env, account, async (connection) => {
    const folder = await resolveDraftsFolder(connection, account, env)
    const result = await appendWithCreate(connection, folder, message, '(\\Draft \\Seen)', 'draft')
    const uid = await appendedUid(connection, result.folder, result.uid)
    return { folder: result.folder, uid }
  })
}

/**
 * Servers without UIDPLUS do not return an APPENDUID: fall back to the folder
 * details or a search so the caller always gets the UID of the new message.
 */
async function appendedUid(
  connection: ImapConnection,
  folder: string,
  uid: number | null,
): Promise<number> {
  if (uid) {
    return uid
  }
  const details = await connection.selectWithDetails(folder)
  if (details.uidNext && details.uidNext > 1) {
    return details.uidNext - 1
  }
  const uids = await connection.searchAll()
  if (uids.length === 0) {
    throw new Error('Message not found after APPEND')
  }
  return Math.max(...uids)
}

export async function fetchMessageAt(
  env: Env,
  account: AccountRow,
  folder: string,
  uid: number,
): Promise<Uint8Array> {
  return withImap(env, account, async (connection) => {
    await connection.select(folder)
    return connection.fetchFull(uid, false)
  })
}

export async function deleteMessageAt(
  env: Env,
  account: AccountRow,
  folder: string,
  uid: number,
): Promise<void> {
  await withImap(env, account, async (connection) => {
    await connection.select(folder)
    await connection.deleteMessage(uid)
  })
}

export async function deleteDraft(
  env: Env,
  account: AccountRow,
  uid: number,
): Promise<void> {
  await withImap(env, account, async (connection) => {
    const folder = await resolveDraftsFolder(connection, account, env)
    await connection.select(folder)
    await connection.deleteMessage(uid)
  })
}

export type MoveTarget = 'inbox' | 'spam' | 'trash'

export async function moveMessages(
  env: Env,
  account: AccountRow,
  folder: Folder,
  uids: number[],
  target: MoveTarget,
): Promise<string> {
  if (uids.length === 0) {
    return ''
  }
  return withImap(env, account, async (connection) => {
    const source = await targetFolder(env, connection, account, folder)
    await connection.select(source)
    const destination =
      target === 'inbox'
        ? 'INBOX'
        : target === 'spam'
          ? await resolveSpamFolder(connection, account, env)
          : await resolveTrashFolder(connection)
    if (destination === source) {
      throw new Error('The destination folder is the same as the source folder')
    }
    try {
      await connection.copyMany(uids, destination)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (!MISSING_FOLDER.test(detail)) {
        throw error
      }
      try {
        await connection.create(destination)
      } catch {
        // It may already exist.
      }
      await connection.copyMany(uids, destination)
    }
    await connection.deleteMany(uids)
    return destination
  })
}

export async function moveToTrash(
  env: Env,
  account: AccountRow,
  folder: Folder,
  uid: number,
): Promise<string> {
  return moveMessages(env, account, folder, [uid], 'trash')
}
