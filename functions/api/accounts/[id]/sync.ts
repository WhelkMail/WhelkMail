import type { Folder } from '../../../../shared/types'
import { getAccountRow } from '../../../_lib/db'
import type { Env } from '../../../_lib/env'
import { fail, json, readJson } from '../../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../../_lib/schema'
import {
  getSyncStates,
  markSyncError,
  runSyncChunk,
} from '../../../_lib/sync'

interface SyncBody {
  folder?: string
}

function toFolder(value: string | undefined): Folder {
  return value === 'sent'
    ? 'sent'
    : value === 'draft'
      ? 'draft'
      : value === 'spam'
        ? 'spam'
        : 'inbox'
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string
    const account = await getAccountRow(context.env, id)
    if (!account) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    if (account.kind !== 'imap') {
      return fail('Sync is only available for IMAP accounts', 400, undefined, 'sync_unsupported')
    }
    return json({ folders: await getSyncStates(context.env, id), hasMore: false })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const body = await readJson<SyncBody>(context.request).catch(() => ({}) as SyncBody)
  const folder = toFolder(body.folder)
  try {
    const account = await getAccountRow(context.env, id)
    if (!account) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    if (account.kind !== 'imap') {
      return fail('Sync is only available for IMAP accounts', 400, undefined, 'sync_unsupported')
    }
    const result = await runSyncChunk(context.env, account, folder)
    return json(result)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    const message = error instanceof Error ? error.message : String(error)
    try {
      await markSyncError(context.env, id, folder, message)
      const folders = await getSyncStates(context.env, id)
      return json({ folders, hasMore: false, error: message })
    } catch {
      return fail('Sync failed', 502, message, 'sync_failed')
    }
  }
}
