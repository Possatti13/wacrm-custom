// ============================================================
// Pipeline Intelligence & Stage Suggestions Domain Types (Phase 10)
// ============================================================

export type StageSuggestionStatus = 'pending' | 'applied' | 'dismissed';

export interface DealStageSuggestion {
  id: string;
  account_id: string;
  deal_id: string;
  suggested_stage_id: string;
  current_stage_id: string;
  status: StageSuggestionStatus;
  reason: string;
  confidence?: number | null;
  insight_id?: string | null;
  created_at: string;
  updated_at: string;

  // Joined relations
  suggested_stage?: {
    id: string;
    name: string;
    color: string;
    position: number;
  } | null;
  current_stage?: {
    id: string;
    name: string;
    color: string;
    position: number;
  } | null;
}

export interface CreateStageSuggestionInput {
  deal_id: string;
  suggested_stage_id: string;
  current_stage_id: string;
  reason: string;
  confidence?: number;
  insight_id?: string | null;
}
