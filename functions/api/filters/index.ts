import { filterCreateSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import {
  labelsExist,
  toFilter,
  type FilterRow,
  type ForwardLogSummary,
} from '../../_lib/filters'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

async function listFilters(env: Env) {
  const result = await env.DB.prepare('SELECT * FROM filters ORDER BY created_at ASC').all<FilterRow>()
  const logs = await env.DB.prepare(
    'SELECT filter_id, status, error, updated_at FROM forward_log ORDER BY updated_at DESC LIMIT 500',
  ).all<ForwardLogSummary>()
  const byFilter = new Map<string, ForwardLogSummary>()
  for (const log of logs.results) {
    if (!byFilter.has(log.filter_id)) {
      byFilter.set(log.filter_id, log)
    }
  }
  return result.results.map((row) => toFilter(row, byFilter.get(row.id)))
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return json({ filters: await listFilters(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await createFilter(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function createFilter(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = filterCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid filter',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'filter_invalid',
    )
  }
  const input = parsed.data
  const labelIds = input.labelIds ?? []
  const forwardTo = [...new Set(input.forwardTo ?? [])]
  if (labelIds.length === 0 && forwardTo.length === 0) {
    return fail(
      'Add a label or a forwarding recipient',
      400,
      undefined,
      'filter_action_required',
    )
  }
  if (!(await labelsExist(context.env, labelIds))) {
    return fail('Label not found', 404, undefined, 'label_not_found')
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await context.env.DB.prepare(
    `INSERT INTO filters (id, account_id, name, from_pattern, to_pattern, subject_pattern, has_words, doesnt_have, has_attachment, label_ids_json, forward_to_json, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      '',
      input.name?.trim() || 'Filter',
      input.from?.trim() || null,
      input.to?.trim() || null,
      input.subject?.trim() || null,
      input.hasWords?.trim() || null,
      input.doesntHave?.trim() || null,
      input.hasAttachment ? 1 : 0,
      JSON.stringify(labelIds),
      JSON.stringify(forwardTo),
      input.enabled === false ? 0 : 1,
      createdAt,
    )
    .run()
  const row = await context.env.DB.prepare('SELECT * FROM filters WHERE id = ?')
    .bind(id)
    .first<FilterRow>()
  if (!row) {
    return fail('Internal error', 500, undefined, 'internal')
  }
  return json({ filter: toFilter(row) }, 201)
}
