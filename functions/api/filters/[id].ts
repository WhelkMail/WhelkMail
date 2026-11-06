import { filterUpdateSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import {
  labelsExist,
  parseLabelIds,
  parseStringArray,
  toFilter,
  type FilterRow,
} from '../../_lib/filters'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  try {
    return await updateFilter(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function updateFilter(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const id = context.params.id as string
  const row = await context.env.DB.prepare('SELECT * FROM filters WHERE id = ?')
    .bind(id)
    .first<FilterRow>()
  if (!row) {
    return fail('Filter not found', 404, undefined, 'filter_not_found')
  }
  const body = await readJson<unknown>(context.request)
  const parsed = filterUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid filter',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'filter_invalid',
    )
  }
  const input = parsed.data
  const labelIds = input.labelIds ?? parseLabelIds(row.label_ids_json)
  const forwardTo = input.forwardTo ?? parseStringArray(row.forward_to_json)
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
  await context.env.DB.prepare(
    `UPDATE filters SET name = ?, from_pattern = ?, to_pattern = ?, subject_pattern = ?, has_words = ?, doesnt_have = ?, has_attachment = ?, label_ids_json = ?, forward_to_json = ?, enabled = ? WHERE id = ?`,
  )
    .bind(
      input.name === undefined ? row.name : input.name.trim() || 'Filter',
      input.from === undefined ? row.from_pattern : input.from?.trim() || null,
      input.to === undefined ? row.to_pattern : input.to?.trim() || null,
      input.subject === undefined ? row.subject_pattern : input.subject?.trim() || null,
      input.hasWords === undefined ? row.has_words : input.hasWords?.trim() || null,
      input.doesntHave === undefined ? row.doesnt_have : input.doesntHave?.trim() || null,
      input.hasAttachment === undefined ? row.has_attachment : input.hasAttachment ? 1 : 0,
      JSON.stringify(labelIds),
      JSON.stringify(forwardTo),
      input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
      id,
    )
    .run()
  const updated = await context.env.DB.prepare('SELECT * FROM filters WHERE id = ?')
    .bind(id)
    .first<FilterRow>()
  if (!updated) {
    return fail('Filter not found', 404, undefined, 'filter_not_found')
  }
  return json({ filter: toFilter(updated) })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string
    const row = await context.env.DB.prepare('SELECT id FROM filters WHERE id = ?')
      .bind(id)
      .first<{ id: string }>()
    if (!row) {
      return fail('Filter not found', 404, undefined, 'filter_not_found')
    }
    await context.env.DB.batch([
      context.env.DB.prepare('DELETE FROM forward_log WHERE filter_id = ?').bind(id),
      context.env.DB.prepare('DELETE FROM filters WHERE id = ?').bind(id),
    ])
    return json({ ok: true })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
