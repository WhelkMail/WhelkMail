import type { Label, LabelColor } from '../../shared/types'
import type { Env } from './env'

export interface LabelRow {
  id: string
  account_id: string | null
  name: string
  color: string
  created_at: string
}

export const LABEL_COLOR_IDS: LabelColor[] = [
  'blue',
  'emerald',
  'amber',
  'violet',
  'rose',
  'cyan',
  'lime',
]

export function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    color: row.color as LabelColor,
    createdAt: row.created_at,
  }
}

export async function ensureGlobalLabel(
  env: Env,
  name: string,
  color: LabelColor = 'blue',
): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM labels WHERE lower(name) = lower(?)')
    .bind(name)
    .first<{ id: string }>()
  if (existing) {
    return existing.id
  }
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, name, color, new Date().toISOString())
    .run()
  return id
}
