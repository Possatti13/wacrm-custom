import { describe, expect, it } from 'vitest'
import { normalizeCatalogTerm, normalizeSku } from './normalization'

describe('Catalog Term Normalization (normalizeCatalogTerm)', () => {
  it('handles basic trimming and lowercasing', () => {
    expect(normalizeCatalogTerm('  Product Name  ')).toBe('product name')
    expect(normalizeCatalogTerm('MOTORCYCLE')).toBe('motorcycle')
  })

  it('strips accents and diacritics', () => {
    expect(normalizeCatalogTerm('Motos Elétricas')).toBe('motos eletricas')
    expect(normalizeCatalogTerm('Financiamento & Veículo')).toBe('financiamento veiculo')
    expect(normalizeCatalogTerm('Segurança e Conforto Especial')).toBe('seguranca e conforto especial')
    expect(normalizeCatalogTerm('ÁÉÍÓÚ àèìòù ãõ âêîôû ç')).toBe('aeiou aeiou ao aeiou c')
  })

  it('normalizes punctuation and symbols into single spaces', () => {
    expect(normalizeCatalogTerm('X-13')).toBe('x 13')
    expect(normalizeCatalogTerm('Model/Version_2026!')).toBe('model version 2026')
    expect(normalizeCatalogTerm('Consultoria (Financiamento + Seguro)')).toBe('consultoria financiamento seguro')
  })

  it('collapses multiple whitespace characters', () => {
    expect(normalizeCatalogTerm('  Scooter   X-13    Pro  Max  ')).toBe('scooter x 13 pro max')
    expect(normalizeCatalogTerm('Motor\n\t  Elétrico')).toBe('motor eletrico')
  })

  it('handles empty or malformed inputs gracefully', () => {
    expect(normalizeCatalogTerm('')).toBe('')
    expect(normalizeCatalogTerm('   ')).toBe('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeCatalogTerm(null as any)).toBe('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeCatalogTerm(undefined as any)).toBe('')
  })
})

describe('SKU Normalization (normalizeSku)', () => {
  it('trims and lowercases SKU strings', () => {
    expect(normalizeSku('  SKU-12345-X  ')).toBe('sku-12345-x')
    expect(normalizeSku('MOTO-X13')).toBe('moto-x13')
  })

  it('returns null for empty strings or null/undefined', () => {
    expect(normalizeSku('')).toBeNull()
    expect(normalizeSku('   ')).toBeNull()
    expect(normalizeSku(null)).toBeNull()
    expect(normalizeSku(undefined)).toBeNull()
  })
})
