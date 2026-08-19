// ============================================================
// Quoted-Text Evidence Matcher (Phase 5A)
//
// Locates deterministic UTF-16 spans for quotes in message texts.
// Policy:
// - 0 occurrences -> reject ('not_found')
// - Exactly 1 occurrence -> accept ({ start_offset, end_offset, snippet })
// - Multiple occurrences -> reject ('ambiguous_multiple_matches')
// ============================================================

export interface MatchEvidenceSpanResult {
  matched: boolean
  start_offset?: number
  end_offset?: number
  snippet?: string
  reason?: 'not_found' | 'ambiguous_multiple_matches' | 'empty_input'
}

export function matchQuotedEvidenceSpan(
  messageText: string | null | undefined,
  quotedText: string | null | undefined
): MatchEvidenceSpanResult {
  if (!messageText || typeof messageText !== 'string' || messageText.length === 0) {
    return { matched: false, reason: 'empty_input' }
  }

  if (!quotedText || typeof quotedText !== 'string' || quotedText.trim().length === 0) {
    return { matched: false, reason: 'empty_input' }
  }

  const cleanQuote = quotedText.trim()
  const cleanMsg = messageText

  // Count occurrences
  let count = 0
  let firstIndex = -1
  let pos = cleanMsg.indexOf(cleanQuote)

  while (pos !== -1) {
    count++
    if (count === 1) {
      firstIndex = pos
    }
    if (count > 1) {
      // Ambiguous multiple occurrences
      return { matched: false, reason: 'ambiguous_multiple_matches' }
    }
    pos = cleanMsg.indexOf(cleanQuote, pos + cleanQuote.length)
  }

  if (count === 0) {
    return { matched: false, reason: 'not_found' }
  }

  return {
    matched: true,
    start_offset: firstIndex,
    end_offset: firstIndex + cleanQuote.length,
    snippet: cleanQuote,
  }
}
