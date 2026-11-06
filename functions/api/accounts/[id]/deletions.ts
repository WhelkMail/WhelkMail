import { getAccountRow } from '../../../_lib/db'
import { listDeletionLogs } from '../../../_lib/deletion'
import type { Env } from '../../../_lib/env'
import { fail, json } from '../../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../../_lib/schema'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string
    const account = await getAccountRow(context.env, id)
    if (!account) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    return json({ logs: await listDeletionLogs(context.env, id) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
