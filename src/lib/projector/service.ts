import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectionRunResult } from './types'
import { projectContactCommercialState } from './repository'

export class CommercialStateProjectorService {
  constructor(private readonly db: SupabaseClient) {}

  async projectContact(
    accountId: string,
    contactId: string,
    triggerSource = 'api'
  ): Promise<ProjectionRunResult> {
    return projectContactCommercialState(this.db, {
      accountId,
      contactId,
      triggerSource,
    })
  }
}
