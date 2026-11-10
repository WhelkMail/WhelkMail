import type { Env } from '../env'
import { isSchemaError } from '../schema'

/** How much plain text per message is kept in the mirror for search. */
export const MAX_SEARCH_TEXT_CHARS = 4000
/** How much of the body is shown in the message list. */
export const MAX_SNIPPET_CHARS = 160

export function normalizeSearchText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_TEXT_CHARS)
}

export function snippetOfSearchText(text: string): string {
  return normalizeSearchText(text).slice(0, MAX_SNIPPET_CHARS)
}

function isMissingColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  // SQLite reports either "no such column: x" or "table t has no column named x"
  // depending on the statement, so accept both phrasings.
  return /no such column|has no column named/i.test(message)
}

/**
 * Store the plain text of a message in the D1 mirror.
 *
 * IMAP accounts used to keep `snippet` empty forever, so search only matched
 * headers. This runs whenever a body is parsed (message opened, archived or
 * snippet backfill) and keeps a short snippet in `imap_messages` plus a longer
 * searchable extract in `search_text`.
 */
export async function indexMessageText(
  env: Env,
  messageId: string,
  text: string,
): Promise<void> {
  const normalized = normalizeSearchText(text)
  if (!normalized) {
    return
  }
  const snippet = snippetOfSearchText(normalized)
  try {
    await env.DB.prepare('UPDATE imap_messages SET snippet = ?, search_text = ? WHERE id = ?')
      .bind(snippet, normalized, messageId)
      .run()
  } catch (error) {
    if (isMissingColumn(error)) {
      // Database created before migration 019: keep the snippet, skip the text.
      await env.DB.prepare('UPDATE imap_messages SET snippet = ? WHERE id = ?')
        .bind(snippet, messageId)
        .run()
        .catch(() => undefined)
      return
    }
    if (!isSchemaError(error)) {
      throw error
    }
  }
}
