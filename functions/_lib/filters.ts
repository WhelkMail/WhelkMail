import type { MailFilter, MessageSummary } from '../../shared/types'
import type { Env } from './env'
import { isSchemaError } from './schema'

export interface FilterRow {
  id: string
  account_id: string
  name: string
  from_pattern: string | null
  to_pattern: string | null
  subject_pattern: string | null
  has_words: string | null
  doesnt_have: string | null
  has_attachment: number
  label_ids_json: string
  forward_to_json: string
  enabled: number
  created_at: string
}

export interface ForwardLogSummary {
  filter_id: string
  status: string
  error: string | null
  updated_at: string
}

export interface FilterForwardMatch {
  filterId: string
  forwardTo: string[]
}

export function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function parseLabelIds(value: string): string[] {
  return parseStringArray(value)
}

export function toFilter(row: FilterRow, last?: ForwardLogSummary): MailFilter {
  return {
    id: row.id,
    name: row.name,
    from: row.from_pattern,
    to: row.to_pattern,
    subject: row.subject_pattern,
    hasWords: row.has_words,
    doesntHave: row.doesnt_have,
    hasAttachment: Boolean(row.has_attachment),
    labelIds: parseLabelIds(row.label_ids_json),
    forwardTo: parseStringArray(row.forward_to_json),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    lastForwardStatus: last?.status ?? null,
    lastForwardError: last?.error ?? null,
    lastForwardAt: last?.updated_at ?? null,
  }
}

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase())
}

function recipientText(message: MessageSummary): string {
  return [...message.to, ...message.cc, ...message.bcc]
    .map((item) => `${item.name ?? ''} ${item.email}`)
    .join(' ')
}

export function matchesFilter(filter: MailFilter, message: MessageSummary): boolean {
  if (message.folder !== 'inbox') {
    return false
  }
  const sender = `${message.from.name ?? ''} ${message.from.email}`
  const recipients = recipientText(message)
  const haystack = `${sender} ${recipients} ${message.subject} ${message.snippet}`
  if (filter.from && !includesText(sender, filter.from)) {
    return false
  }
  if (filter.to && !includesText(recipients, filter.to)) {
    return false
  }
  if (filter.subject && !includesText(message.subject, filter.subject)) {
    return false
  }
  if (filter.hasWords && !includesText(haystack, filter.hasWords)) {
    return false
  }
  if (filter.doesntHave && includesText(haystack, filter.doesntHave)) {
    return false
  }
  if (filter.hasAttachment && !message.hasAttachments) {
    return false
  }
  return true
}

export async function labelsExist(env: Env, labelIds: string[]): Promise<boolean> {
  if (labelIds.length === 0) {
    return true
  }
  const placeholders = labelIds.map(() => '?').join(', ')
  const found = await env.DB.prepare(
    `SELECT id FROM labels WHERE id IN (${placeholders})`,
  )
    .bind(...labelIds)
    .all<{ id: string }>()
  return found.results.length === labelIds.length
}

export async function applyFilters(
  env: Env,
  accountId: string,
  messages: MessageSummary[],
): Promise<FilterForwardMatch[]> {
  if (!messages.some((message) => message.folder === 'inbox')) {
    return []
  }
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM filters WHERE enabled = 1',
    ).all<FilterRow>()
    const filters = result.results.map((row) => toFilter(row))
    if (filters.length === 0) {
      return []
    }
    const createdAt = new Date().toISOString()
    const statements: D1PreparedStatement[] = []
    const forwards: FilterForwardMatch[] = []
    for (const message of messages) {
      if (message.folder !== 'inbox') {
        continue
      }
      for (const filter of filters) {
        if (!matchesFilter(filter, message)) {
          continue
        }
        if (filter.forwardTo.length > 0) {
          forwards.push({ filterId: filter.id, forwardTo: filter.forwardTo })
        }
        for (const labelId of filter.labelIds) {
          if (message.labelIds.includes(labelId)) {
            continue
          }
          message.labelIds.push(labelId)
          statements.push(
            env.DB.prepare(
              'INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
            ).bind(message.id, accountId, message.folder, labelId, createdAt),
          )
        }
      }
    }
    if (statements.length > 0) {
      await env.DB.batch(statements)
    }
    return forwards
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
    return []
  }
}

export async function applyAccountLabel(
  env: Env,
  accountId: string,
  labelId: string | null,
  messages: MessageSummary[],
): Promise<void> {
  if (!labelId) {
    return
  }
  try {
    const createdAt = new Date().toISOString()
    const statements: D1PreparedStatement[] = []
    for (const message of messages) {
      if (message.folder !== 'inbox' || message.labelIds.includes(labelId)) {
        continue
      }
      message.labelIds.push(labelId)
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO message_labels (message_id, account_id, folder, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(message.id, accountId, message.folder, labelId, createdAt),
      )
    }
    if (statements.length > 0) {
      await env.DB.batch(statements)
    }
  } catch (error) {
    if (!isSchemaError(error)) {
      throw error
    }
  }
}
