import type { PeriodRange } from '../types';

export type ManagerIntent =
  | 'executive_summary'
  | 'attention_queue'
  | 'objection_analysis'
  | 'objection_drilldown'
  | 'product_intelligence'
  | 'team_performance'
  | 'signals_pipeline'
  | 'followup_health'
  | 'coaching_intelligence'
  | 'clarification'
  | 'unsupported';

export type AllowlistedToolName =
  | 'manager.summary'
  | 'manager.attention'
  | 'manager.objections'
  | 'manager.objection_drilldown'
  | 'manager.products'
  | 'manager.team'
  | 'manager.signals_pipeline'
  | 'manager.coaching_summary'
  | 'manager.coaching_opportunities'
  | 'manager.coaching_patterns';

export interface ResolvedPeriod {
  range: PeriodRange;
  start?: string | null;
  end?: string | null;
  label?: string;
}

export interface PlannedToolCall {
  tool_name: AllowlistedToolName;
  args: Record<string, unknown>;
}

export interface PlannerOutput {
  intent: ManagerIntent;
  period: ResolvedPeriod;
  tool_calls: PlannedToolCall[];
  clarification_required: boolean;
  clarification_question?: string;
  unsupported_reason?: string;
}

export interface FactDrilldownRef {
  type: 'objections' | 'attention' | 'products' | 'team' | 'deals' | 'coaching';
  title?: string;
  taxonomy_id?: string;
  taxonomy_code?: string;
  product_id?: string;
  seller_id?: string;
  filter?: Record<string, unknown>;
}

export interface Fact {
  fact_id: string; // e.g. "F1", "F2"
  metric: string;
  label: string;
  value: number | string | boolean | null;
  unit?: string; // "occurrences", "percent", "seconds", "deals", "contacts", etc.
  period?: ResolvedPeriod;
  source: string;
  numerator?: number;
  denominator?: number;
  metadata?: Record<string, unknown>;
  drilldown_ref?: FactDrilldownRef;
}

/**
 * Server-side private entity resolution item for Leads.
 * NEVER serialized to LLM synthesis or planner payloads.
 */
export interface OpaqueLeadEntity {
  lead_token: string; // "LEAD_1", "LEAD_2"
  contact_id: string;
  contact_name: string;
  phone?: string | null;
  score?: number | null;
  reasons?: string[];
}

/**
 * Server-side private entity resolution item for Sellers/Employees.
 * NEVER serialized to external LLM synthesis payloads.
 */
export interface OpaqueSellerEntity {
  seller_token: string; // "SELLER_1", "SELLER_2"
  user_id: string;
  full_name: string;
  role: string;
}

/**
 * Server-side private entity maps. Kept separate from fact packets.
 */
export type PrivateEntityMap = Record<string, OpaqueLeadEntity>;
export type PrivateSellerMap = Record<string, OpaqueSellerEntity>;

/**
 * Canonical factual packet sent to external LLM providers (Synthesis/Planner).
 * Contains ZERO PII (no contact_name, no phone, no email, no private entity maps).
 */
export interface ProviderFactPacket {
  question_context: {
    original_question: string;
    normalized_question: string;
    period: ResolvedPeriod;
    timezone: string;
  };
  facts: Fact[];
}

/**
 * FactPacket alias for backwards-compatibility and internal usage.
 */
export type FactPacket = ProviderFactPacket;

export interface ClaimNumericRef {
  fact_id: string;
  field?: string;
  rendered_value: number;
}

export interface Claim {
  text: string;
  fact_ids: string[];
  numeric_refs?: ClaimNumericRef[];
}

export interface Recommendation {
  text: string;
  based_on_fact_ids: string[];
}

export interface DrilldownAction {
  label: string;
  drilldown_ref: FactDrilldownRef;
}

export interface SynthesisOutput {
  answer: string;
  claims: Claim[];
  recommendations: Recommendation[];
  drilldowns: DrilldownAction[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AskCiclopesRequestParams {
  accountId: string;
  userId: string;
  userRole: 'owner' | 'admin';
  question: string;
  threadId?: string | null;
  forceRefresh?: boolean;
}

export interface AskCiclopesResult {
  requestId: string;
  threadId: string;
  turnId: string;
  question: string;
  answer: string;
  claims: Claim[];
  recommendations: Recommendation[];
  drilldowns: DrilldownAction[];
  resolvedPeriod: ResolvedPeriod;
  facts: Fact[];
  opaqueEntities: PrivateEntityMap;
  cached: boolean;
  provider: string;
  model: string;
  plannerTokens?: TokenUsage | null;
  synthesisTokens?: TokenUsage | null;
  latencyMs: number;
  createdAt: string;
}
