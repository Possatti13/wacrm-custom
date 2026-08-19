import { describe, it, expect } from 'vitest'
import { matchQuotedEvidenceSpan } from './evidence-matcher'

describe('Evidence Matcher (Quoted Text & Span Ambiguity Policy)', () => {
  const messageText = 'Olá! Gostei muito da scooter X-13, mas achei o preço alto.'

  it('matches unique quoted text and returns exact UTF-16 offsets', () => {
    const res = matchQuotedEvidenceSpan(messageText, 'scooter X-13')
    expect(res.matched).toBe(true)
    expect(res.start_offset).toBe(21)
    expect(res.end_offset).toBe(33)
    expect(res.snippet).toBe('scooter X-13')
  })

  it('matches Portuguese accents and punctuation uniquely', () => {
    const res = matchQuotedEvidenceSpan(messageText, 'preço alto')
    expect(res.matched).toBe(true)
    expect(res.start_offset).toBe(47)
    expect(res.end_offset).toBe(57)
  })

  it('rejects quote not found in message text', () => {
    const res = matchQuotedEvidenceSpan(messageText, 'moto elétrica')
    expect(res.matched).toBe(false)
    expect(res.reason).toBe('not_found')
  })

  it('rejects ambiguous quote with multiple occurrences in the same message', () => {
    const repeatedMsg = 'Quero comprar hoje porque comprar amanhã fica mais caro.'
    const res = matchQuotedEvidenceSpan(repeatedMsg, 'comprar')
    expect(res.matched).toBe(false)
    expect(res.reason).toBe('ambiguous_multiple_matches')
  })

  it('accepts specific quote that resolves ambiguity', () => {
    const repeatedMsg = 'Quero comprar hoje porque comprar amanhã fica mais caro.'
    const res = matchQuotedEvidenceSpan(repeatedMsg, 'comprar hoje')
    expect(res.matched).toBe(true)
    expect(res.start_offset).toBe(6)
    expect(res.end_offset).toBe(18)
  })

  it('rejects empty or null inputs safely', () => {
    expect(matchQuotedEvidenceSpan(null, 'teste')).toEqual({ matched: false, reason: 'empty_input' })
    expect(matchQuotedEvidenceSpan(messageText, '')).toEqual({ matched: false, reason: 'empty_input' })
    expect(matchQuotedEvidenceSpan('', '')).toEqual({ matched: false, reason: 'empty_input' })
  })
})
