import { describe, expect, it } from 'vitest'
import {
  validateCreateCategory,
  validateUpdateCategory,
  validateCreateCatalogItem,
  validateUpdateCatalogItem,
  validateAlias,
  CatalogValidationError,
} from './validation'

describe('Catalog Validation Functions', () => {
  describe('validateCreateCategory', () => {
    it('validates valid category input', () => {
      const res = validateCreateCategory({
        name: '  Motos Elétricas  ',
        description: '  Linha de motos urbanas  ',
        sort_order: 10,
      })
      expect(res.name).toBe('Motos Elétricas')
      expect(res.description).toBe('Linha de motos urbanas')
      expect(res.sort_order).toBe(10)
    })

    it('throws on empty category name', () => {
      expect(() => validateCreateCategory({ name: '' })).toThrow(CatalogValidationError)
      expect(() => validateCreateCategory({ name: '   ' })).toThrow(CatalogValidationError)
    })

    it('throws on non-numeric sort_order', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => validateCreateCategory({ name: 'Cat', sort_order: 'bad' as any })).toThrow(
        CatalogValidationError
      )
    })
  })

  describe('validateUpdateCategory', () => {
    it('validates partial update input', () => {
      const res = validateUpdateCategory({ name: 'Nova Categoria' })
      expect(res.name).toBe('Nova Categoria')
      expect(res.description).toBeUndefined()
    })

    it('throws on empty name if provided', () => {
      expect(() => validateUpdateCategory({ name: '   ' })).toThrow(CatalogValidationError)
    })
  })

  describe('validateCreateCatalogItem', () => {
    it('validates valid product input', () => {
      const res = validateCreateCatalogItem({
        name: 'X-13',
        type: 'product',
        category_id: 'cat-uuid-1',
        description: 'Scooter elétrica',
        sku: 'SKU-X13',
        status: 'active',
        sort_order: 5,
        aliases: ['X13', 'Moto X13'],
      })
      expect(res.name).toBe('X-13')
      expect(res.type).toBe('product')
      expect(res.sku).toBe('SKU-X13')
      expect(res.aliases).toEqual(['X13', 'Moto X13'])
    })

    it('validates valid service input', () => {
      const res = validateCreateCatalogItem({
        name: 'Consultoria Financeira',
        type: 'service',
      })
      expect(res.type).toBe('service')
      expect(res.status).toBe('active')
    })

    it('throws on invalid item type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => validateCreateCatalogItem({ name: 'Item', type: 'vehicle' as any })).toThrow(
        /Item type must be either 'product' or 'service'/
      )
    })

    it('throws on invalid item status', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => validateCreateCatalogItem({ name: 'Item', type: 'product', status: 'draft' as any })).toThrow(
        /Invalid item status/
      )
    })

    it('throws on item name with no alphanumeric characters', () => {
      expect(() => validateCreateCatalogItem({ name: '---', type: 'product' })).toThrow(
        /must contain at least one alphanumeric character/
      )
    })
  })

  describe('validateUpdateCatalogItem', () => {
    it('validates partial item updates', () => {
      const res = validateUpdateCatalogItem({ status: 'archived', sort_order: 20 })
      expect(res.status).toBe('archived')
      expect(res.sort_order).toBe(20)
    })

    it('throws on invalid type in update', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => validateUpdateCatalogItem({ type: 'unknown' as any })).toThrow(
        CatalogValidationError
      )
    })
  })

  describe('validateAlias', () => {
    it('validates valid alias string', () => {
      expect(validateAlias('  Scooter X13  ')).toBe('Scooter X13')
    })

    it('throws on empty or non-alphanumeric alias', () => {
      expect(() => validateAlias('')).toThrow(CatalogValidationError)
      expect(() => validateAlias('   ')).toThrow(CatalogValidationError)
      expect(() => validateAlias('---')).toThrow(CatalogValidationError)
    })
  })
})
