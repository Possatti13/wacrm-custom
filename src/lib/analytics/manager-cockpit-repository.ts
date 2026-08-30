import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ManagerCockpitSummary,
  AttentionQueueResponse,
  ObjectionAnalyticsResponse,
  ObjectionDrilldownResponse,
  ProductIntelligenceResponse,
  TeamPerformanceResponse,
  SignalsAndPipelineResponse,
  PeriodRange,
} from './types';

export async function loadManagerCockpitSummary(
  db: SupabaseClient,
  accountId: string,
  range: PeriodRange = '30d',
  startDate?: string,
  endDate?: string
): Promise<ManagerCockpitSummary> {
  const { data, error } = await db.rpc('get_manager_cockpit_summary', {
    p_account_id: accountId,
    p_time_range: range,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });

  if (error) {
    console.error('[manager-cockpit] loadManagerCockpitSummary error:', error);
    throw new Error(error.message);
  }

  return data as ManagerCockpitSummary;
}

export async function loadManagerAttentionQueue(
  db: SupabaseClient,
  accountId: string,
  priorityFilter: 'all' | 'urgent' | 'high' | 'medium' = 'all',
  limit: number = 20,
  offset: number = 0
): Promise<AttentionQueueResponse> {
  const { data, error } = await db.rpc('get_manager_attention_queue', {
    p_account_id: accountId,
    p_priority_filter: priorityFilter,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('[manager-cockpit] loadManagerAttentionQueue error:', error);
    throw new Error(error.message);
  }

  return data as AttentionQueueResponse;
}

export async function loadManagerObjectionAnalytics(
  db: SupabaseClient,
  accountId: string,
  range: PeriodRange = '30d',
  startDate?: string,
  endDate?: string
): Promise<ObjectionAnalyticsResponse> {
  const { data, error } = await db.rpc('get_manager_objection_analytics', {
    p_account_id: accountId,
    p_time_range: range,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });

  if (error) {
    console.error('[manager-cockpit] loadManagerObjectionAnalytics error:', error);
    throw new Error(error.message);
  }

  return data as ObjectionAnalyticsResponse;
}

export async function loadManagerObjectionDrilldown(
  db: SupabaseClient,
  accountId: string,
  params: {
    taxonomyId?: string;
    taxonomyCode?: string;
    range?: PeriodRange;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }
): Promise<ObjectionDrilldownResponse> {
  const { data, error } = await db.rpc('get_manager_objection_drilldown', {
    p_account_id: accountId,
    p_taxonomy_id: params.taxonomyId || null,
    p_taxonomy_code: params.taxonomyCode || null,
    p_time_range: params.range || '30d',
    p_start_date: params.startDate || null,
    p_end_date: params.endDate || null,
    p_limit: params.limit || 20,
    p_offset: params.offset || 0,
  });

  if (error) {
    console.error('[manager-cockpit] loadManagerObjectionDrilldown error:', error);
    throw new Error(error.message);
  }

  return data as ObjectionDrilldownResponse;
}

export async function loadManagerProductIntelligence(
  db: SupabaseClient,
  accountId: string,
  range: PeriodRange = '30d',
  startDate?: string,
  endDate?: string
): Promise<ProductIntelligenceResponse> {
  const { data, error } = await db.rpc('get_manager_product_intelligence', {
    p_account_id: accountId,
    p_time_range: range,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });

  if (error) {
    console.error('[manager-cockpit] loadManagerProductIntelligence error:', error);
    throw new Error(error.message);
  }

  return data as ProductIntelligenceResponse;
}

export async function loadManagerTeamPerformance(
  db: SupabaseClient,
  accountId: string,
  range: PeriodRange = '30d',
  startDate?: string,
  endDate?: string
): Promise<TeamPerformanceResponse> {
  const { data, error } = await db.rpc('get_manager_team_performance', {
    p_account_id: accountId,
    p_time_range: range,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });

  if (error) {
    console.error('[manager-cockpit] loadManagerTeamPerformance error:', error);
    throw new Error(error.message);
  }

  return data as TeamPerformanceResponse;
}

export async function loadManagerSignalsAndPipeline(
  db: SupabaseClient,
  accountId: string,
  range: PeriodRange = '30d',
  startDate?: string,
  endDate?: string
): Promise<SignalsAndPipelineResponse> {
  const { data, error } = await db.rpc('get_manager_signals_and_pipeline', {
    p_account_id: accountId,
    p_time_range: range,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });

  if (error) {
    console.error('[manager-cockpit] loadManagerSignalsAndPipeline error:', error);
    throw new Error(error.message);
  }

  return data as SignalsAndPipelineResponse;
}
