/**
 * Pure, deterministic normalization for catalog terms and aliases.
 *
 * Pipeline:
 * 1. Trim leading and trailing whitespace.
 * 2. Unicode normalization (NFKD).
 * 3. Lowercase conversion.
 * 4. Diacritic and accent removal (e.g. "Elétricas" -> "eletricas").
 * 5. Symbol and punctuation separation/replacement with spaces (hyphens, slashes, punctuation).
 * 6. Whitespace collapse to single space.
 * 7. Final trim.
 *
 * Examples:
 * - "  X-13  " -> "x 13"
 * - "Motos Elétricas" -> "motos eletricas"
 * - "Financiamento / Seguro" -> "financiamento seguro"
 * - "Scooter X-13 (2026)" -> "scooter x 13 2026"
 */
export function normalizeCatalogTerm(term: string): string {
  if (!term || typeof term !== 'string') {
    return ''
  }

  return term
    .trim()
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9\s]/g, ' ') // replace symbols/punctuation with spaces
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .trim()
}

/**
 * Normalizes SKU strings consistently:
 * Trims and lowercases. Returns null if empty.
 */
export function normalizeSku(sku: string | null | undefined): string | null {
  if (!sku || typeof sku !== 'string') {
    return null
  }
  const clean = sku.trim().toLowerCase()
  return clean.length > 0 ? clean : null
}
