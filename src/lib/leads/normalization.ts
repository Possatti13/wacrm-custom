// ============================================================
// Normalization Pipeline for Objections (Phase 3B)
// ============================================================

/**
 * Deterministic text normalization pipeline for objection phrases:
 * 1. Trim leading and trailing whitespace
 * 2. Unicode decomposition (NFKD)
 * 3. Lowercase transformation
 * 4. Strip combining diacritical marks (accents, tildes, cedillas)
 * 5. Replace non-alphanumeric punctuation/symbols with spaces
 * 6. Collapse multiple consecutive spaces to a single space
 * 7. Final trim
 */
export function normalizeObjection(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''

  return raw
    .trim()
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
