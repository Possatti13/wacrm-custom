import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContactLeadProfile,
  ContactCatalogInterest,
  ContactCatalogInterestWithItem,
  ContactObjection,
  ContactCommercialContext,
  UpsertLeadProfileInput,
  RecordCatalogInterestInput,
  RecordObjectionInput,
  InterestStatus,
  ObjectionStatus,
  InformationSource,
} from './types'
import {
  getLeadProfile,
  upsertLeadProfile,
  deleteLeadProfile,
  recordCatalogInterest,
  updateCatalogInterestStatus,
  dismissCatalogInterest,
  reactivateCatalogInterest,
  listCatalogInterests,
  recordObjection,
  updateObjectionStatus,
  resolveObjection,
  dismissObjection,
  reactivateObjection,
  listObjections,
  getCommercialContext,
} from './repository'

export class LeadProfileService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly accountId: string
  ) {
    if (!accountId || typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new Error('LeadProfileService requires a valid accountId')
    }
  }

  // Profile
  async getProfile(contactId: string): Promise<ContactLeadProfile | null> {
    return getLeadProfile(this.db, this.accountId, contactId)
  }

  async upsertProfile(contactId: string, input: UpsertLeadProfileInput): Promise<ContactLeadProfile> {
    return upsertLeadProfile(this.db, this.accountId, contactId, input)
  }

  async deleteProfile(contactId: string): Promise<boolean> {
    return deleteLeadProfile(this.db, this.accountId, contactId)
  }

  // Interests
  async recordInterest(contactId: string, input: RecordCatalogInterestInput): Promise<ContactCatalogInterest> {
    return recordCatalogInterest(this.db, this.accountId, contactId, input)
  }

  async updateInterestStatus(
    contactId: string,
    catalogItemId: string,
    status: InterestStatus,
    source?: InformationSource
  ): Promise<ContactCatalogInterest> {
    return updateCatalogInterestStatus(this.db, this.accountId, contactId, catalogItemId, status, source)
  }

  async dismissInterest(
    contactId: string,
    catalogItemId: string,
    source?: InformationSource
  ): Promise<ContactCatalogInterest> {
    return dismissCatalogInterest(this.db, this.accountId, contactId, catalogItemId, source)
  }

  async reactivateInterest(
    contactId: string,
    catalogItemId: string,
    source?: InformationSource
  ): Promise<ContactCatalogInterest> {
    return reactivateCatalogInterest(this.db, this.accountId, contactId, catalogItemId, source)
  }

  async listInterests(contactId: string, status?: InterestStatus): Promise<ContactCatalogInterestWithItem[]> {
    return listCatalogInterests(this.db, this.accountId, contactId, status)
  }

  // Objections
  async recordObjection(contactId: string, input: RecordObjectionInput): Promise<ContactObjection> {
    return recordObjection(this.db, this.accountId, contactId, input)
  }

  async updateObjectionStatus(
    objectionId: string,
    status: ObjectionStatus,
    source?: InformationSource
  ): Promise<ContactObjection> {
    return updateObjectionStatus(this.db, this.accountId, objectionId, status, source)
  }

  async resolveObjection(objectionId: string, source?: InformationSource): Promise<ContactObjection> {
    return resolveObjection(this.db, this.accountId, objectionId, source)
  }

  async dismissObjection(objectionId: string, source?: InformationSource): Promise<ContactObjection> {
    return dismissObjection(this.db, this.accountId, objectionId, source)
  }

  async reactivateObjection(objectionId: string, source?: InformationSource): Promise<ContactObjection> {
    return reactivateObjection(this.db, this.accountId, objectionId, source)
  }

  async listObjections(contactId: string, status?: ObjectionStatus): Promise<ContactObjection[]> {
    return listObjections(this.db, this.accountId, contactId, status)
  }

  // Commercial Context
  async getCommercialContext(contactId: string): Promise<ContactCommercialContext> {
    return getCommercialContext(this.db, this.accountId, contactId)
  }
}
