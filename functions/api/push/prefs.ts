import { pushPrefsSchema } from '../../../shared/schemas'
import type { Folder, PushPrefs } from '../../../shared/types'
import { listAccountRows } from '../../_lib/db'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

interface PushPrefsRow {
  account_id: string
  enabled: number
  folders_json: string
  updated_at: string
}

function parseFolders(value: string): Folder[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return ['inbox']
    }
    return parsed.filter(
      (item): item is Folder => item === 'inbox' || item === 'sent' || item === 'draft',
    )
  } catch {
    return ['inbox']
  }
}

async function listPrefs(env: Env): Promise<PushPrefs[]> {
  const accounts = await listAccountRows(env)
  const rows = await env.DB.prepare('SELECT * FROM push_prefs').all<PushPrefsRow>()
  const byAccount = new Map(rows.results.map((row) => [row.account_id, row]))
  return accounts.map((account) => {
    const row = byAccount.get(account.id)
    return {
      accountId: account.id,
      email: account.email,
      enabled: row ? Boolean(row.enabled) : true,
      folders: row ? parseFolders(row.folders_json) : ['inbox'],
    }
  })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return json({ prefs: await listPrefs(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  try {
    const parsed = pushPrefsSchema.safeParse(await readJson<unknown>(context.request))
    if (!parsed.success) {
      return fail('Invalid preferences', 400, undefined, 'push_prefs_invalid')
    }
    const input = parsed.data
    const account = await context.env.DB.prepare('SELECT id FROM accounts WHERE id = ?')
      .bind(input.accountId)
      .first<{ id: string }>()
    if (!account) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    const existing = await context.env.DB.prepare(
      'SELECT * FROM push_prefs WHERE account_id = ?',
    )
      .bind(input.accountId)
      .first<PushPrefsRow>()
    const enabled = input.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : input.enabled
    const folders =
      input.folders ?? (existing ? parseFolders(existing.folders_json) : (['inbox'] as Folder[]))
    await context.env.DB.prepare(
      `INSERT INTO push_prefs (account_id, enabled, folders_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET enabled = excluded.enabled, folders_json = excluded.folders_json, updated_at = excluded.updated_at`,
    )
      .bind(input.accountId, enabled ? 1 : 0, JSON.stringify(folders), new Date().toISOString())
      .run()
    return json({ ok: true, prefs: await listPrefs(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
