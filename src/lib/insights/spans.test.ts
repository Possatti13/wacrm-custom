import { describe, it, expect } from 'vitest'
import { extractSnippet, validateSpanOffsets } from './spans'

describe('Spans & Offset Contract', () => {
  describe('extractSnippet', () => {
    it('extracts snippet from regular ASCII text', () => {
      const text = 'Gostei muito da scooter X-13!'
      expect(extractSnippet(text, 16, 28)).toBe('scooter X-13')
    })

    it('extracts snippet with accents and diacritics', () => {
      const text = 'Achei o preço da moto elétríca muito alto.'
      expect(extractSnippet(text, 8, 13)).toBe('preço')
      expect(extractSnippet(text, 17, 30)).toBe('moto elétríca')
    })

    it('extracts snippet with emojis and surrogate pairs according to UTF-16 code units contract', () => {
      // 🛵 is 2 UTF-16 code units (\uD83D\uDEF5), 👋 is 2 UTF-16 code units (\uD83D\uDC4B)
      const text = '🛵 Olá 👋 quero saber o preço!'
      // '🛵 ' is 3 units (indices 0..2)
      // 'Olá ' is 4 units (indices 3..6)
      // '👋 ' is 3 units (indices 7..9)
      // 'quero saber o preço!' is at index 10..30
      expect(extractSnippet(text, 0, 2)).toBe('🛵')
      expect(extractSnippet(text, 3, 6)).toBe('Olá')
      expect(extractSnippet(text, 7, 9)).toBe('👋')
      expect(extractSnippet(text, 10, 30)).toBe('quero saber o preço!')
    })

    it('returns null for missing or invalid offsets', () => {
      expect(extractSnippet('text', null, null)).toBeNull()
      expect(extractSnippet('text', 5, 2)).toBeNull()
      expect(extractSnippet('text', -1, 3)).toBeNull()
    })
  })

  describe('validateSpanOffsets', () => {
    it('accepts both null (full message evidence)', () => {
      expect(validateSpanOffsets('Qualquer texto', null, null)).toEqual({ valid: true })
      expect(validateSpanOffsets('Qualquer texto', undefined, undefined)).toEqual({ valid: true })
    })

    it('rejects only one offset provided', () => {
      const res1 = validateSpanOffsets('Qualquer texto', 5, null)
      expect(res1.valid).toBe(false)
      expect(res1.error).toContain('must be provided together')

      const res2 = validateSpanOffsets('Qualquer texto', null, 10)
      expect(res2.valid).toBe(false)
    })

    it('rejects end_offset <= start_offset', () => {
      const res1 = validateSpanOffsets('Texto', 5, 5)
      expect(res1.valid).toBe(false)

      const res2 = validateSpanOffsets('Texto', 10, 5)
      expect(res2.valid).toBe(false)
    })

    it('rejects end_offset exceeding message length', () => {
      const res = validateSpanOffsets('Curto', 0, 20)
      expect(res.valid).toBe(false)
      expect(res.error).toContain('exceeds message text length')
    })
  })
})
