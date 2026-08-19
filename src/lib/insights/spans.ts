// ============================================================
// Offset Contract & Spans Helpers (Phase 3C)
//
// Convention:
// - start_offset and end_offset represent 0-indexed UTF-16 code units,
//   matching JavaScript String length and String.prototype.substring(start, end).
// - Both offsets must be null (full message evidence) OR both must be numbers
//   satisfying 0 <= start_offset < end_offset <= text.length.
// ============================================================

export function extractSnippet(
  text: string | null | undefined,
  startOffset?: number | null,
  endOffset?: number | null
): string | null {
  if (!text || typeof text !== 'string') return null
  if (startOffset === undefined || startOffset === null || endOffset === undefined || endOffset === null) {
    return null
  }
  if (startOffset < 0 || endOffset <= startOffset || startOffset >= text.length) {
    return null
  }
  return text.substring(startOffset, Math.min(endOffset, text.length))
}

export function validateSpanOffsets(
  text: string | null | undefined,
  startOffset?: number | null,
  endOffset?: number | null
): { valid: boolean; error?: string } {
  const hasStart = startOffset !== undefined && startOffset !== null
  const hasEnd = endOffset !== undefined && endOffset !== null

  if (!hasStart && !hasEnd) {
    return { valid: true }
  }

  if (hasStart !== hasEnd) {
    return {
      valid: false,
      error: 'Both start_offset and end_offset must be provided together, or both must be null',
    }
  }

  const start = startOffset as number
  const end = endOffset as number

  if (!Number.isInteger(start) || start < 0) {
    return { valid: false, error: 'start_offset must be a non-negative integer' }
  }

  if (!Number.isInteger(end) || end <= start) {
    return { valid: false, error: 'end_offset must be an integer strictly greater than start_offset' }
  }

  if (text !== undefined && text !== null) {
    if (typeof text !== 'string') {
      return { valid: false, error: 'Message text must be a string' }
    }
    if (end > text.length) {
      return {
        valid: false,
        error: `end_offset (${end}) exceeds message text length (${text.length})`,
      }
    }
  }

  return { valid: true }
}
