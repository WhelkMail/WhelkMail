/**
 * Conversation keys.
 *
 * `thread_key` is the Message-ID of the root of a conversation, lowercased and
 * without angle brackets. A message that is not a reply is its own root, so
 * nothing is ever rewritten when a reply arrives later: the reply adopts the key
 * of its parent. Threads are per account.
 *
 * Pure and dependency free so the rules can be tested without IMAP or D1.
 */

/** `"<ABC@x.it>"` → `abc@x.it`. */
export function normalizeMessageId(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase())
    .filter(Boolean)[0] ?? ''
}

/** Every id in a `References` header, in order, normalized. */
export function referenceIds(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase())
    .filter(Boolean)
}

export interface ThreadKeyInput {
  messageId: string | null | undefined
  inReplyTo: string | null | undefined
  references: string | null | undefined
  /** Key already stored for the parent, when the mirror knows it. */
  parentKey?: string | null
  /** Stable fallback (hash) for messages without a Message-ID. */
  fallback: string
}

/**
 * Root of the conversation this message belongs to.
 *
 * `References[0]` is the root by RFC 5322; clients truncate long chains, so when
 * the mirror already knows the parent's key we trust it instead. A message
 * without threading headers becomes the root of its own conversation.
 */
export function threadKeyFor(input: ThreadKeyInput): string {
  const own = normalizeMessageId(input.messageId)
  const parent = normalizeMessageId(input.inReplyTo)
  const root = referenceIds(input.references)[0] ?? parent
  const candidate = input.parentKey?.trim() || root || own
  return candidate || input.fallback
}

/**
 * Subject without the reply/forward prefixes, lowercased and collapsed.
 *
 * `Re: Re: Fattura 12` and `Fattura 12` share the same normalized subject. This
 * is the fallback Gmail uses when a message carries no `References`: without it,
 * a reply that lost its threading headers opens a conversation of its own.
 */
export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) {
    return ''
  }
  let value = subject.trim()
  let changed = true
  const PREFIX = /^(re|r|aw|sv|vs|rif|fwd|fw|i)\s*(\[\d+\])?\s*:\s*/i
  while (changed) {
    changed = false
    const next = value.replace(PREFIX, '')
    if (next !== value) {
      value = next
      changed = true
    }
  }
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

export interface SubjectThreadRow {
  id: string
  subject: string | null
  threadKey: string | null
  sentAt: string
}

/**
 * Merge conversations that share a normalized subject.
 *
 * Used by the bulk rebuild: rows already in the mirror have no threading headers
 * at hand, but their subject is enough to put a reply back into the conversation
 * it belongs to. The oldest message of the group keeps its key, the others adopt
 * it, so nothing has to be recomputed twice.
 */
export function mergeThreadsBySubject(rows: SubjectThreadRow[]): Map<string, string> {
  const updates = new Map<string, string>()
  const bySubject = new Map<string, SubjectThreadRow[]>()

  for (const row of rows) {
    const subject = normalizeSubject(row.subject)
    if (!subject) {
      continue
    }
    const bucket = bySubject.get(subject) ?? []
    bucket.push(row)
    bySubject.set(subject, bucket)
  }

  for (const bucket of bySubject.values()) {
    if (bucket.length < 2) {
      continue
    }
    bucket.sort((left, right) => left.sentAt.localeCompare(right.sentAt))
    const root = bucket[0].threadKey ?? bucket[0].id
    for (const row of bucket) {
      const current = row.threadKey ?? row.id
      if (current !== root) {
        updates.set(row.id, root)
      }
    }
  }
  return updates
}
