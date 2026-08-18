import type { SupabaseClient } from '@supabase/supabase-js'
import * as repo from './repository'
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateCatalogItemInput,
  UpdateCatalogItemInput,
  ListCatalogItemsFilter,
  CatalogCategory,
  CatalogItem,
  CatalogItemTerm,
  CatalogItemWithDetails,
  ResolvedCatalogTerm,
} from './types'

export class CatalogService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly accountId: string
  ) {
    if (!accountId || typeof accountId !== 'string') {
      throw new Error('CatalogService requires a valid accountId')
    }
  }

  // Categories
  async createCategory(input: CreateCategoryInput): Promise<CatalogCategory> {
    return repo.createCategory(this.db, this.accountId, input)
  }

  async updateCategory(categoryId: string, input: UpdateCategoryInput): Promise<CatalogCategory> {
    return repo.updateCategory(this.db, this.accountId, categoryId, input)
  }

  async deleteCategory(categoryId: string): Promise<boolean> {
    return repo.deleteCategory(this.db, this.accountId, categoryId)
  }

  async getCategory(categoryId: string): Promise<CatalogCategory | null> {
    return repo.getCategory(this.db, this.accountId, categoryId)
  }

  async listCategories(): Promise<CatalogCategory[]> {
    return repo.listCategories(this.db, this.accountId)
  }

  // Items
  async createItem(input: CreateCatalogItemInput): Promise<CatalogItemWithDetails> {
    return repo.createCatalogItem(this.db, this.accountId, input)
  }

  async updateItem(itemId: string, input: UpdateCatalogItemInput): Promise<CatalogItemWithDetails> {
    return repo.updateCatalogItem(this.db, this.accountId, itemId, input)
  }

  async archiveItem(itemId: string): Promise<CatalogItem> {
    return repo.archiveCatalogItem(this.db, this.accountId, itemId)
  }

  async getItem(itemId: string): Promise<CatalogItemWithDetails | null> {
    return repo.getCatalogItem(this.db, this.accountId, itemId)
  }

  async listItems(filter?: ListCatalogItemsFilter): Promise<CatalogItem[]> {
    return repo.listCatalogItems(this.db, this.accountId, filter)
  }

  // Terms and Aliases
  async addAlias(itemId: string, alias: string): Promise<CatalogItemTerm> {
    return repo.addCatalogItemAlias(this.db, this.accountId, itemId, alias)
  }

  async removeAlias(termId: string): Promise<boolean> {
    return repo.removeCatalogItemAlias(this.db, this.accountId, termId)
  }

  async listTerms(itemId?: string): Promise<CatalogItemTerm[]> {
    return repo.listCatalogItemTerms(this.db, this.accountId, itemId)
  }

  async resolveTerm(rawTerm: string): Promise<ResolvedCatalogTerm | null> {
    return repo.resolveCatalogTerm(this.db, this.accountId, rawTerm)
  }
}
