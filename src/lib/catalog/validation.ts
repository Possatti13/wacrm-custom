import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateCatalogItemInput,
  UpdateCatalogItemInput,
  CatalogItemType,
  CatalogItemStatus,
} from './types'
import { normalizeCatalogTerm } from './normalization'

const VALID_TYPES: CatalogItemType[] = ['product', 'service']
const VALID_STATUSES: CatalogItemStatus[] = ['active', 'inactive', 'archived']

export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogValidationError'
  }
}

export function validateCreateCategory(input: unknown): CreateCategoryInput {
  if (!input || typeof input !== 'object') {
    throw new CatalogValidationError('Category input must be an object')
  }

  const record = input as Record<string, unknown>
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    throw new CatalogValidationError('Category name is required and cannot be empty')
  }

  let sort_order = 0
  if (record.sort_order !== undefined) {
    if (typeof record.sort_order !== 'number' || isNaN(record.sort_order)) {
      throw new CatalogValidationError('sort_order must be a valid number')
    }
    sort_order = Math.floor(record.sort_order)
  }

  return {
    name: record.name.trim(),
    description: typeof record.description === 'string' ? record.description.trim() : null,
    sort_order,
  }
}

export function validateUpdateCategory(input: unknown): UpdateCategoryInput {
  if (!input || typeof input !== 'object') {
    throw new CatalogValidationError('Category input must be an object')
  }

  const record = input as Record<string, unknown>
  const output: UpdateCategoryInput = {}

  if (record.name !== undefined) {
    if (typeof record.name !== 'string' || record.name.trim().length === 0) {
      throw new CatalogValidationError('Category name cannot be empty')
    }
    output.name = record.name.trim()
  }

  if (record.description !== undefined) {
    output.description = typeof record.description === 'string' ? record.description.trim() : null
  }

  if (record.sort_order !== undefined) {
    if (typeof record.sort_order !== 'number' || isNaN(record.sort_order)) {
      throw new CatalogValidationError('sort_order must be a valid number')
    }
    output.sort_order = Math.floor(record.sort_order)
  }

  return output
}

export function validateCreateCatalogItem(input: unknown): CreateCatalogItemInput {
  if (!input || typeof input !== 'object') {
    throw new CatalogValidationError('Catalog item input must be an object')
  }

  const record = input as Record<string, unknown>
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    throw new CatalogValidationError('Item name is required and cannot be empty')
  }

  const normalizedName = normalizeCatalogTerm(record.name)
  if (normalizedName.length === 0) {
    throw new CatalogValidationError('Item name must contain at least one alphanumeric character')
  }

  if (typeof record.type !== 'string' || !VALID_TYPES.includes(record.type as CatalogItemType)) {
    throw new CatalogValidationError(`Item type must be either 'product' or 'service'. Received: ${String(record.type)}`)
  }

  let status: CatalogItemStatus = 'active'
  if (record.status !== undefined) {
    if (typeof record.status !== 'string' || !VALID_STATUSES.includes(record.status as CatalogItemStatus)) {
      throw new CatalogValidationError(`Invalid item status: ${String(record.status)}`)
    }
    status = record.status as CatalogItemStatus
  }

  let sort_order = 0
  if (record.sort_order !== undefined) {
    if (typeof record.sort_order !== 'number' || isNaN(record.sort_order)) {
      throw new CatalogValidationError('sort_order must be a valid number')
    }
    sort_order = Math.floor(record.sort_order)
  }

  const aliases: string[] = []
  if (Array.isArray(record.aliases)) {
    for (const a of record.aliases) {
      if (typeof a === 'string' && a.trim().length > 0) {
        aliases.push(a.trim())
      }
    }
  }

  return {
    name: record.name.trim(),
    type: record.type as CatalogItemType,
    category_id: typeof record.category_id === 'string' && record.category_id.trim().length > 0 ? record.category_id.trim() : null,
    description: typeof record.description === 'string' ? record.description.trim() : null,
    sku: typeof record.sku === 'string' && record.sku.trim().length > 0 ? record.sku.trim() : null,
    status,
    sort_order,
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {},
    aliases,
  }
}

export function validateUpdateCatalogItem(input: unknown): UpdateCatalogItemInput {
  if (!input || typeof input !== 'object') {
    throw new CatalogValidationError('Catalog item input must be an object')
  }

  const record = input as Record<string, unknown>
  const output: UpdateCatalogItemInput = {}

  if (record.name !== undefined) {
    if (typeof record.name !== 'string' || record.name.trim().length === 0) {
      throw new CatalogValidationError('Item name cannot be empty')
    }
    const norm = normalizeCatalogTerm(record.name)
    if (norm.length === 0) {
      throw new CatalogValidationError('Item name must contain at least one alphanumeric character')
    }
    output.name = record.name.trim()
  }

  if (record.type !== undefined) {
    if (typeof record.type !== 'string' || !VALID_TYPES.includes(record.type as CatalogItemType)) {
      throw new CatalogValidationError(`Item type must be either 'product' or 'service'. Received: ${String(record.type)}`)
    }
    output.type = record.type as CatalogItemType
  }

  if (record.status !== undefined) {
    if (typeof record.status !== 'string' || !VALID_STATUSES.includes(record.status as CatalogItemStatus)) {
      throw new CatalogValidationError(`Invalid item status: ${String(record.status)}`)
    }
    output.status = record.status as CatalogItemStatus
  }

  if (record.category_id !== undefined) {
    output.category_id = typeof record.category_id === 'string' && record.category_id.trim().length > 0 ? record.category_id.trim() : null
  }

  if (record.description !== undefined) {
    output.description = typeof record.description === 'string' ? record.description.trim() : null
  }

  if (record.sku !== undefined) {
    output.sku = typeof record.sku === 'string' && record.sku.trim().length > 0 ? record.sku.trim() : null
  }

  if (record.sort_order !== undefined) {
    if (typeof record.sort_order !== 'number' || isNaN(record.sort_order)) {
      throw new CatalogValidationError('sort_order must be a valid number')
    }
    output.sort_order = Math.floor(record.sort_order)
  }

  if (record.metadata !== undefined) {
    if (record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)) {
      output.metadata = record.metadata as Record<string, unknown>
    }
  }

  return output
}

export function validateAlias(alias: unknown): string {
  if (typeof alias !== 'string' || alias.trim().length === 0) {
    throw new CatalogValidationError('Alias must be a non-empty string')
  }
  const norm = normalizeCatalogTerm(alias)
  if (norm.length === 0) {
    throw new CatalogValidationError('Alias must contain at least one alphanumeric character')
  }
  return alias.trim()
}
