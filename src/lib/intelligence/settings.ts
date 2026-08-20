import type { SupabaseClient } from '@supabase/supabase-js'
import { validateUuid } from '../leads/validation'

export interface TenantIntelligenceSettings {
  id?: string
  account_id: string
  enabled: boolean
  provider: 'openai' | 'anthropic' | 'xai' | 'mock'
  model: string
  extractor_version: string
  prompt_version: string
  temperature: number
  timeout_ms: number
  created_at?: string
  updated_at?: string
}

export async function getTenantIntelligenceSettings(
  db: SupabaseClient,
  accountId: string
): Promise<TenantIntelligenceSettings | null> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('tenant_intelligence_settings')
    .select('*')
    .eq('account_id', validAccId)
    .maybeSingle()

  if (error) {
    throw new Error(`getTenantIntelligenceSettings failed: ${error.message}`)
  }

  return (data as TenantIntelligenceSettings) || null
}

export async function saveTenantIntelligenceSettings(
  db: SupabaseClient,
  accountId: string,
  settings: Partial<TenantIntelligenceSettings>
): Promise<TenantIntelligenceSettings> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db.rpc('save_tenant_intelligence_settings', {
    p_account_id: validAccId,
    p_settings: settings,
  })

  if (error) {
    throw new Error(`saveTenantIntelligenceSettings failed: ${error.message}`)
  }

  return data as TenantIntelligenceSettings
}
