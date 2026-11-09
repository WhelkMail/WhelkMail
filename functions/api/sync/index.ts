import type { AccountSyncOverview, SyncOverview } from '../../../shared/types'
import { listAccountRows } from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { json } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'
import { getSyncStates } from '../../_lib/sync'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const accounts = await listAccountRows(context.env)
    const overview: AccountSyncOverview[] = []
    for (const account of accounts) {
      if (account.kind !== 'imap') {
        continue
      }
      const folders = await getSyncStates(context.env, account.id)
      overview.push({
        accountId: account.id,
        email: account.email,
        syncing: folders.some((folder) => folder.status === 'partial'),
        folders,
      })
    }
    const result: SyncOverview = {
      accounts: overview,
      syncing: overview.some((account) => account.syncing),
    }
    return json(result)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
