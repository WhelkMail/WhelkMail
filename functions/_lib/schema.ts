import { fail } from './http'

export function isSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such (table|column)/i.test(message)
}

export function schemaOutdated(_error?: unknown): Response {
  return fail(
    'Database schema is outdated',
    503,
    'Run npm run db:migrate:remote (or npm run db:migrate:local) to update the database schema.',
    'schema_outdated',
  )
}
