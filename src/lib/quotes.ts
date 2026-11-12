const QUOTE_MARKER =
  /^\s*(?:On\s.+\swrote:\s*$|Il giorno\s.+\sha scritto:\s*$|-{2,}\s*(?:Original Message|Messaggio originale)\s*-{2,}|_{5,}\s*$|>{1})/im

/**
 * Split a plain-text body at the start of the quoted original, the way Gmail
 * collapses "the message you replied to".
 */
export function splitQuotedText(text: string): { body: string; quote: string } | null {
  const match = QUOTE_MARKER.exec(text)
  if (!match || match.index <= 0) {
    return null
  }
  const body = text.slice(0, match.index).trimEnd()
  const quote = text.slice(match.index).trim()
  if (!body || !quote) {
    return null
  }
  return { body, quote }
}
