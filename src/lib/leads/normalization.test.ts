import { describe, it, expect } from 'vitest'
import { normalizeObjection } from './normalization'

describe('normalizeObjection', () => {
  it('normalizes accents, diacritics and casing', () => {
    expect(normalizeObjection('Preço muito alto!')).toBe('preco muito alto')
    expect(normalizeObjection('NÃO TENHO DINHEIRO')).toBe('nao tenho dinheiro')
    expect(normalizeObjection('Taxa de adesão é cara')).toBe('taxa de adesao e cara')
  })

  it('collapses multiple whitespace and trims', () => {
    expect(normalizeObjection('   prazo    longo   ')).toBe('prazo longo')
    expect(normalizeObjection('\tsem  garantia\n')).toBe('sem garantia')
  })

  it('replaces punctuation and symbols with spaces', () => {
    expect(normalizeObjection('preço/custo (muito) caro!')).toBe('preco custo muito caro')
    expect(normalizeObjection('juros @ 10% a.m.')).toBe('juros 10 a m')
  })

  it('handles empty or non-string inputs safely', () => {
    expect(normalizeObjection('')).toBe('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeObjection(null as any)).toBe('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeObjection(undefined as any)).toBe('')
  })
})
