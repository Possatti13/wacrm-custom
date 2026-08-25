import type { SupabaseClient } from '@supabase/supabase-js';
import type { DealStageSuggestion, CreateStageSuggestionInput } from '@/types/pipeline-intelligence';
import type { Deal } from '@/types';

export async function listPendingStageSuggestions(
  db: SupabaseClient,
  accountId: string,
  dealIds?: string[]
): Promise<DealStageSuggestion[]> {
  let query = db
    .from('deal_stage_suggestions')
    .select(`
      *,
      suggested_stage:pipeline_stages!deal_stage_suggestions_suggested_stage_id_fkey(id, name, color, position),
      current_stage:pipeline_stages!deal_stage_suggestions_current_stage_id_fkey(id, name, color, position)
    `)
    .eq('account_id', accountId)
    .eq('status', 'pending');

  if (dealIds && dealIds.length > 0) {
    query = query.in('deal_id', dealIds);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`listPendingStageSuggestions failed: ${error.message}`);
  }

  return (data || []) as unknown as DealStageSuggestion[];
}

export async function createStageSuggestion(
  db: SupabaseClient,
  accountId: string,
  input: CreateStageSuggestionInput
): Promise<DealStageSuggestion> {
  const { data, error } = await db
    .from('deal_stage_suggestions')
    .insert({
      account_id: accountId,
      deal_id: input.deal_id,
      suggested_stage_id: input.suggested_stage_id,
      current_stage_id: input.current_stage_id,
      reason: input.reason.trim(),
      confidence: input.confidence ?? null,
      insight_id: input.insight_id || null,
      status: 'pending',
    })
    .select(`
      *,
      suggested_stage:pipeline_stages!deal_stage_suggestions_suggested_stage_id_fkey(id, name, color, position),
      current_stage:pipeline_stages!deal_stage_suggestions_current_stage_id_fkey(id, name, color, position)
    `)
    .single();

  if (error) {
    throw new Error(`createStageSuggestion failed: ${error.message}`);
  }

  return data as unknown as DealStageSuggestion;
}

export async function applyStageSuggestion(
  db: SupabaseClient,
  accountId: string,
  suggestionId: string
): Promise<Deal> {
  const { data, error } = await db.rpc('apply_deal_stage_suggestion', {
    p_account_id: accountId,
    p_suggestion_id: suggestionId,
  });

  if (error) {
    throw new Error(`applyStageSuggestion failed: ${error.message}`);
  }

  return data as unknown as Deal;
}

export async function dismissStageSuggestion(
  db: SupabaseClient,
  accountId: string,
  suggestionId: string
): Promise<void> {
  const { error } = await db.rpc('dismiss_deal_stage_suggestion', {
    p_account_id: accountId,
    p_suggestion_id: suggestionId,
  });

  if (error) {
    throw new Error(`dismissStageSuggestion failed: ${error.message}`);
  }
}
