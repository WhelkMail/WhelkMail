import { appSettingsSchema } from '../../../shared/schemas'
import type { AppSettings } from '../../../shared/types'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

const DEFAULT_SIGNATURE_KEY = 'default_signature'
const SIGNATURE_MODE_KEY = 'signature_mode'
const ALLOW_REMOTE_IMAGES_KEY = 'allow_remote_images'
const METADATA_RETENTION_KEY = 'metadata_retention_days'

export async function getSettings(env: Env): Promise<AppSettings> {
  const result = await env.DB.prepare(
    'SELECT key, value FROM app_settings WHERE key IN (?, ?, ?, ?)',
  )
    .bind(DEFAULT_SIGNATURE_KEY, SIGNATURE_MODE_KEY, ALLOW_REMOTE_IMAGES_KEY, METADATA_RETENTION_KEY)
    .all<{ key: string; value: string }>()
  const values = new Map(result.results.map((row) => [row.key, row.value]))
  const mode = values.get(SIGNATURE_MODE_KEY)
  const retention = Number(values.get(METADATA_RETENTION_KEY) ?? '0')
  return {
    defaultSignature: values.get(DEFAULT_SIGNATURE_KEY) ?? '',
    signatureMode: mode === 'per_account' ? 'per_account' : 'shared',
    allowRemoteImages: values.get(ALLOW_REMOTE_IMAGES_KEY) === '1',
    metadataRetentionDays: Number.isFinite(retention) && retention > 0 ? Math.floor(retention) : 0,
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return json(await getSettings(context.env))
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  try {
    return await updateSettings(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function updateSettings(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = appSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid settings',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'settings_invalid',
    )
  }
  const statements: D1PreparedStatement[] = []
  if (parsed.data.defaultSignature !== undefined) {
    statements.push(
      context.env.DB.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind(DEFAULT_SIGNATURE_KEY, parsed.data.defaultSignature),
    )
  }
  if (parsed.data.signatureMode !== undefined) {
    statements.push(
      context.env.DB.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind(SIGNATURE_MODE_KEY, parsed.data.signatureMode),
    )
  }
  if (parsed.data.allowRemoteImages !== undefined) {
    statements.push(
      context.env.DB.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind(ALLOW_REMOTE_IMAGES_KEY, parsed.data.allowRemoteImages ? '1' : '0'),
    )
  }
  if (parsed.data.metadataRetentionDays !== undefined) {
    statements.push(
      context.env.DB.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind(METADATA_RETENTION_KEY, String(parsed.data.metadataRetentionDays)),
    )
  }
  if (statements.length > 0) {
    await context.env.DB.batch(statements)
  }
  return json(await getSettings(context.env))
}
