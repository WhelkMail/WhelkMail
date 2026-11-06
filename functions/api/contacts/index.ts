import { contactCreateSchema } from '../../../shared/schemas'
import type { Contact } from '../../../shared/types'
import { normalizeEmail, toContact, type ContactRow } from '../../_lib/contacts'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url)
    const query = url.searchParams.get('q')?.trim() ?? ''
    const rows = query
      ? await context.env.DB.prepare(
          'SELECT * FROM contacts WHERE lower(name) LIKE ? OR lower(email) LIKE ? ORDER BY name COLLATE NOCASE ASC LIMIT 500',
        )
          .bind(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`)
          .all<ContactRow>()
      : await context.env.DB.prepare(
          'SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC LIMIT 500',
        ).all<ContactRow>()
    return json({ contacts: rows.results.map(toContact) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await createContact(context)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

async function createContact(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = await readJson<unknown>(context.request)
  const parsed = contactCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid contact',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'contact_invalid',
    )
  }
  const email = normalizeEmail(parsed.data.email)
  const existing = await context.env.DB.prepare(
    'SELECT * FROM contacts WHERE lower(email) = ?',
  )
    .bind(email)
    .first<ContactRow>()
  if (existing) {
    const name = parsed.data.name
    const note = parsed.data.note === undefined ? existing.note : parsed.data.note
    await context.env.DB.prepare('UPDATE contacts SET name = ?, note = ? WHERE id = ?')
      .bind(name, note, existing.id)
      .run()
    const updated = await context.env.DB.prepare('SELECT * FROM contacts WHERE id = ?')
      .bind(existing.id)
      .first<ContactRow>()
    if (!updated) {
      return fail('Internal error', 500, undefined, 'internal')
    }
    return json({ contact: toContact(updated) })
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await context.env.DB.prepare(
    'INSERT INTO contacts (id, name, email, note, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, parsed.data.name, email, parsed.data.note ?? null, createdAt)
    .run()
  return json(
    {
      contact: {
        id,
        name: parsed.data.name,
        email,
        note: parsed.data.note ?? '',
        createdAt,
      } satisfies Contact,
    },
    201,
  )
}
