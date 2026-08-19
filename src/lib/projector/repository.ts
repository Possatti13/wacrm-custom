import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ProjectionRunResult,
  ProjectContactCommercialStateParams,
  CommercialProvenanceRecord,
} from './types'
import { validateUuid } from '@/lib/commercial-config/validation'

export async function projectContactCommercialState(
  db: SupabaseClient,
  params: ProjectContactCommercialStateParams
): Promise<ProjectionRunResult> {
  const validAccId = validateUuid(params.accountId, 'accountId')
  const validContactId = validateUuid(params.contactId, 'contactId')

  const { data, error } = await db.rpc('project_contact_commercial_state', {
    p_account_id: validAccId,
    p_contact_id: validContactId,
    p_trigger_source: params.triggerSource || 'api',
  })

  if (error) {
    throw new Error(`projectContactCommercialState failed: ${error.message}`)
  }

  return data as ProjectionRunResult
}

export async function getContactProvenance(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<CommercialProvenanceRecord[]> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  const { data, error } = await db
    .from('contact_commercial_provenance')
    .select('*')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`getContactProvenance failed: ${error.message}`)
  }

  return (data || []) as CommercialProvenanceRecord[]
}
