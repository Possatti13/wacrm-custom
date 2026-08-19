import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommercialIntent,
  CommercialAttributeDefinition,
  TenantCommercialContext,
  TenantCommercialTerminology,
  TenantConfigRevision,
  SaveIntentInput,
  SaveAttributeDefinitionInput,
  SaveContextInput,
  SaveTerminologyInput,
  ConfigEntityStatus,
} from './types'
import {
  saveCommercialIntent,
  archiveCommercialIntent,
  listCommercialIntents,
  saveCommercialAttributeDefinition,
  archiveCommercialAttributeDefinition,
  listCommercialAttributeDefinitions,
  saveTenantCommercialContext,
  getTenantCommercialContext,
  saveTenantCommercialTerminology,
  getTenantCommercialTerminology,
  getLatestConfigRevision,
  listConfigRevisions,
} from './repository'
import {
  validateLeadProfileAttributes,
  validateCurrentIntentAssignment,
} from './validation'

export class CommercialConfigService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly accountId: string
  ) {
    if (!accountId || typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new Error('CommercialConfigService requires a valid accountId')
    }
  }

  // Intents
  async saveIntent(input: SaveIntentInput): Promise<{ intent: CommercialIntent; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
    return saveCommercialIntent(this.db, this.accountId, input)
  }

  async archiveIntent(intentId: string, changeSummary?: string): Promise<{ intent: CommercialIntent; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
    return archiveCommercialIntent(this.db, this.accountId, intentId, changeSummary)
  }

  async listIntents(options?: { status?: ConfigEntityStatus }): Promise<CommercialIntent[]> {
    return listCommercialIntents(this.db, this.accountId, options)
  }

  // Attributes
  async saveAttribute(input: SaveAttributeDefinitionInput): Promise<{ attribute: CommercialAttributeDefinition; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
    return saveCommercialAttributeDefinition(this.db, this.accountId, input)
  }

  async archiveAttribute(attributeId: string, changeSummary?: string): Promise<{ attribute: CommercialAttributeDefinition; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
    return archiveCommercialAttributeDefinition(this.db, this.accountId, attributeId, changeSummary)
  }

  async listAttributes(options?: { status?: ConfigEntityStatus }): Promise<CommercialAttributeDefinition[]> {
    return listCommercialAttributeDefinitions(this.db, this.accountId, options)
  }

  // Context
  async saveContext(input: SaveContextInput): Promise<{ context: TenantCommercialContext; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
    return saveTenantCommercialContext(this.db, this.accountId, input)
  }

  async getContext(): Promise<TenantCommercialContext | null> {
    return getTenantCommercialContext(this.db, this.accountId)
  }

  // Terminology
  async saveTerminology(input: SaveTerminologyInput): Promise<{ terminology: TenantCommercialTerminology; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
    return saveTenantCommercialTerminology(this.db, this.accountId, input)
  }

  async getTerminology(): Promise<TenantCommercialTerminology | null> {
    return getTenantCommercialTerminology(this.db, this.accountId)
  }

  // Revisions
  async getLatestRevision(): Promise<TenantConfigRevision | null> {
    return getLatestConfigRevision(this.db, this.accountId)
  }

  async listRevisions(limit = 20): Promise<TenantConfigRevision[]> {
    return listConfigRevisions(this.db, this.accountId, limit)
  }

  // Lead Profile Attribute Validator
  async validateAttributes(attributes: Record<string, unknown>): Promise<Record<string, unknown>> {
    const definitions = await this.listAttributes({ status: 'active' })
    return validateLeadProfileAttributes(definitions, attributes)
  }

  // Lead Profile Current Intent Validator
  async validateCurrentIntent(currentIntent: string | null | undefined): Promise<string | null> {
    const intents = await this.listIntents({ status: 'active' })
    return validateCurrentIntentAssignment(intents, currentIntent)
  }
}
