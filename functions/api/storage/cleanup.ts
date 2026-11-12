import type { Env } from '../../_lib/env'
import { json } from '../../_lib/http'
import {
  clearCleanupFailures,
  listCleanupFailures,
} from '../../_lib/storage/cleanup-log'

/**
 * Objects left behind by an account purge. The account (and its Drive token)
 * is gone by the time a removal fails, so these rows are the only trace.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const entries = await listCleanupFailures(context.env)
  return json({
    entries: entries.map((entry) => ({
      id: entry.id,
      accountEmail: entry.accountEmail,
      driver: entry.driver,
      key: entry.key,
      error: entry.error,
      createdAt: entry.createdAt,
    })),
  })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await clearCleanupFailures(context.env)
  return json({ ok: true })
}
