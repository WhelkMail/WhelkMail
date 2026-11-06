import type { Contact } from '../../shared/types'

export interface ContactRow {
  id: string
  name: string
  email: string
  note: string | null
  created_at: string
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    note: row.note ?? '',
    createdAt: row.created_at,
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
