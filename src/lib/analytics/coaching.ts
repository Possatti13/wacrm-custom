import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PeriodRange,
  CoachingSummaryResponse,
  CoachingOpportunitiesResponse,
  CoachingPatternsResponse,
  ConversationReviewPayload,
  CoachingCategory,
  CoachingReviewStatus,
} from './types';

export interface GetCoachingParams {
  range?: PeriodRange;
  customStart?: string;
  customEnd?: string;
  sellerId?: string;
  category?: CoachingCategory;
  status?: CoachingReviewStatus | 'all';
  limit?: number;
  offset?: number;
}

export async function getManagerCoachingSummary(
  supabase: SupabaseClient,
  accountId: string,
  params: GetCoachingParams = {}
): Promise<CoachingSummaryResponse> {
  const { data, error } = await supabase.rpc('get_manager_coaching_summary', {
    p_account_id: accountId,
    p_range: params.range || '30d',
    p_custom_start: params.customStart || null,
    p_custom_end: params.customEnd || null,
  });

  if (error) throw error;
  return data as CoachingSummaryResponse;
}

export async function getManagerCoachingOpportunities(
  supabase: SupabaseClient,
  accountId: string,
  params: GetCoachingParams = {}
): Promise<CoachingOpportunitiesResponse> {
  const { data, error } = await supabase.rpc('get_manager_coaching_opportunities', {
    p_account_id: accountId,
    p_range: params.range || '30d',
    p_custom_start: params.customStart || null,
    p_custom_end: params.customEnd || null,
    p_seller_id: params.sellerId || null,
    p_category: params.category || null,
    p_status: params.status || 'open',
    p_limit: params.limit || 20,
    p_offset: params.offset || 0,
  });

  if (error) throw error;
  return data as CoachingOpportunitiesResponse;
}

export async function getManagerCoachingPatterns(
  supabase: SupabaseClient,
  accountId: string,
  params: GetCoachingParams = {}
): Promise<CoachingPatternsResponse> {
  const { data, error } = await supabase.rpc('get_manager_coaching_patterns', {
    p_account_id: accountId,
    p_range: params.range || '30d',
    p_custom_start: params.customStart || null,
    p_custom_end: params.customEnd || null,
    p_seller_id: params.sellerId || null,
  });

  if (error) throw error;
  return data as CoachingPatternsResponse;
}

export async function getManagerCoachingConversation(
  supabase: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<ConversationReviewPayload> {
  const { data, error } = await supabase.rpc('get_manager_coaching_conversation', {
    p_account_id: accountId,
    p_conversation_id: conversationId,
  });

  if (error) throw error;
  return data as ConversationReviewPayload;
}

export async function updateManagerCoachingOpportunityStatus(
  supabase: SupabaseClient,
  accountId: string,
  opportunityKey: string,
  status: CoachingReviewStatus,
  notes?: string,
  dismissedReason?: string
): Promise<{ success: boolean; opportunity_key: string; status: string; reviewed_at: string }> {
  const { data, error } = await supabase.rpc('update_manager_coaching_opportunity_status', {
    p_account_id: accountId,
    p_opportunity_key: opportunityKey,
    p_status: status,
    p_notes: notes || null,
    p_dismissed_reason: dismissedReason || null,
  });

  if (error) throw error;
  return data;
}
