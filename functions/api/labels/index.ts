import { labelCreateSchema } from '../../../shared/schemas'
import type { Label } from '../../../shared/types'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { toLabel, type LabelRow } from '../../_lib/labels'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

async function listLabels(env: Env): Promise<Label[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM labels ORDER BY name COLLATE NOCASE ASC',
  ).all<LabelRow>()
  return result.results.map(toLabel)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return json({ labels: await listLabels(context.env) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await createLabel(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function createLabel(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = labelCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid label',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'label_invalid',
    )
  }
  const input = parsed.data
  const existing = await context.env.DB.prepare(
    'SELECT id FROM labels WHERE lower(name) = lower(?)',
  )
    .bind(input.name)
    .first<{ id: string }>()
  if (existing) {
    return fail('A label with this name already exists', 409, undefined, 'label_exists')
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await context.env.DB.prepare(
    'INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, input.name, input.color, createdAt)
    .run()
  return json(
    {
      label: {
        id,
        name: input.name,
        color: input.color,
        createdAt,
      } satisfies Label,
    },
    201,
  )
}
