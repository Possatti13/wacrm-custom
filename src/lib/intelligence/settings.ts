import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '../leads/validation';
import type { InvocationMode, TenantCostStats } from './types';

export interface TenantIntelligenceSettings {
  id?: string;
  account_id: string;
  enabled: boolean;
  invocation_mode: InvocationMode;
  provider: 'openai' | 'anthropic' | 'xai' | 'mock';
  model: string;
  extractor_version: string;
  prompt_version: string;
  temperature: number;
  timeout_ms: number;
  max_ai_actions_per_day?: number;
  max_ai_actions_per_month?: number;
  monthly_budget_limit_usd?: number | null;
  created_at?: string;
  updated_at?: string;
}

export async function getTenantIntelligenceSettings(
  db: SupabaseClient,
  accountId: string
): Promise<TenantIntelligenceSettings | null> {
  const validAccId = validateUuid(accountId, 'accountId');

  const { data, error } = await db
    .from('tenant_intelligence_settings')
    .select('*')
    .eq('account_id', validAccId)
    .maybeSingle();

  if (error) {
    throw new Error(`getTenantIntelligenceSettings failed: ${error.message}`);
  }

  if (!data) return null;

  return {
    ...data,
    invocation_mode: data.invocation_mode || 'on_demand',
  } as TenantIntelligenceSettings;
}

export async function saveTenantIntelligenceSettings(
  db: SupabaseClient,
  accountId: string,
  settings: Partial<TenantIntelligenceSettings>
): Promise<TenantIntelligenceSettings> {
  const validAccId = validateUuid(accountId, 'accountId');

  const { data, error } = await db.rpc('save_tenant_intelligence_settings', {
    p_account_id: validAccId,
    p_settings: settings,
  });

  if (error) {
    throw new Error(`saveTenantIntelligenceSettings failed: ${error.message}`);
  }

  return data as TenantIntelligenceSettings;
}

export async function getTenantAiCostStats(
  db: SupabaseClient,
  accountId: string
): Promise<TenantCostStats> {
  const validAccId = validateUuid(accountId, 'accountId');

  const { data, error } = await db.rpc('get_tenant_ai_cost_stats', {
    p_account_id: validAccId,
  });

  if (error) {
    throw new Error(`getTenantAiCostStats failed: ${error.message}`);
  }

  return data as TenantCostStats;
}
