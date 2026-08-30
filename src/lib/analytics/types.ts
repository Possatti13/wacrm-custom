/**
 * TypeScript types for Manager Cockpit Analytics RPCs and Components (V1.4.1)
 */

export type PeriodRange = 'today' | '7d' | '30d' | 'month' | 'custom';

export interface PeriodBounds {
  range: PeriodRange;
  timezone: string;
  curr_start: string;
  curr_end: string;
  prev_start: string;
  prev_end: string;
}

export interface KpiValueWithDelta {
  current: number;
  previous?: number | null;
  delta_pct?: number | null;
  is_snapshot?: boolean;
}

export interface LeadScoreTiers {
  current: number;
  warm: number;
  cold: number;
  is_snapshot?: boolean;
}

export interface PipelineSnapshotKpi {
  open_deals_count: number;
  open_deals_value: number;
  is_snapshot?: boolean;
}

export interface ExecutivePulse {
  active_leads: KpiValueWithDelta;
  hot_leads: LeadScoreTiers;
  overdue_followups: { current: number; is_snapshot: boolean };
  leads_without_next_action: { current: number; is_snapshot: boolean };
  period_objections: KpiValueWithDelta;
  pipeline_snapshot: PipelineSnapshotKpi;
}

export interface WhatChangedHighlight {
  type: string;
  direction: 'up' | 'down' | 'neutral';
  severity: 'positive' | 'warning' | 'danger' | 'info';
  text: string;
}

export interface OperationalHealth {
  unassigned_conversations: number;
  unassigned_followups: number;
  leads_without_next_action: number;
  intelligence_status: {
    enabled: boolean;
    invocation_mode: string;
    provider: string | null;
    model: string | null;
    backlog_count: number;
  };
}

export interface DataFreshness {
  last_message_at: string | null;
  last_analysis_at: string | null;
  evaluated_at: string;
}

export interface ManagerCockpitSummary {
  period: PeriodBounds;
  executive_pulse: ExecutivePulse;
  what_changed: WhatChangedHighlight[];
  operational_health: OperationalHealth;
  data_freshness: DataFreshness;
}

export interface AttentionQueueItem {
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  conversation_id: string;
  reason_code: 'buying_signal_no_action' | 'task_overdue' | 'hot_lead_no_action' | 'unassigned_conversation';
  reason_label: string;
  priority: 'urgent' | 'high' | 'medium';
  score: number;
  score_tier: 'hot' | 'warm' | 'cold';
  responsible_user_id: string | null;
  responsible_user_name: string;
  signal_text: string | null;
  product_id: string | null;
  product_name: string | null;
  idle_time_seconds: number;
  next_action_text: string | null;
  next_action_due_at: string | null;
  task_id: string | null;
  event_time: string;
}

export interface AttentionQueueResponse {
  total_count: number;
  urgent_count: number;
  high_count: number;
  medium_count: number;
  limit: number;
  offset: number;
  items: AttentionQueueItem[];
}

export interface TopObjectionItem {
  taxonomy_id: string;
  code: string;
  name: string;
  count: number;
  percentage: number;
  previous_count: number;
  delta_pct: number | null;
  sample_quote: string | null;
}

export interface ObjectionTrendPoint {
  date: string;
  category: string;
  count: number;
}

export interface ObjectionAnalyticsResponse {
  total_count: number;
  previous_total_count: number;
  delta_pct: number | null;
  top_objections: TopObjectionItem[];
  trend: ObjectionTrendPoint[];
}

export interface ObjectionOccurrenceDetail {
  occurrence_id: string;
  conversation_id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  raw_objection: string;
  confidence: number;
  occurred_at: string;
  taxonomy_name: string;
  taxonomy_code: string;
  catalog_item_id: string | null;
  catalog_item_name: string | null;
  responsible_user_id: string | null;
  responsible_user_name: string;
  override_at: string | null;
  override_reason: string | null;
  override_by_user_name: string | null;
  evidence_snippet: string | null;
}

export interface ObjectionDrilldownResponse {
  total_count: number;
  limit: number;
  offset: number;
  items: ObjectionOccurrenceDetail[];
}

export interface ProductIntelligenceItem {
  catalog_item_id: string;
  name: string;
  sku: string | null;
  type: string | null;
  description: string | null;
  unique_interested_contacts: number;
  interest_occurrences: number;
  objection_occurrences: number;
  friction_rate: number;
  top_objection_name: string | null;
  top_objection_code: string | null;
  top_objection_count: number;
}

export interface ProductIntelligenceResponse {
  products: ProductIntelligenceItem[];
}

export interface TeamMemberPerformance {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
  conversations_handled: number;
  messages_sent: number;
  median_response_seconds: number | null;
  p90_response_seconds: number | null;
  followups_completed: number;
  followups_on_time: number;
  followups_on_time_pct: number | null;
  followups_overdue: number;
  hot_leads_without_action: number;
  objections_encountered: number;
}

export interface TeamPerformanceResponse {
  team: TeamMemberPerformance[];
}

export interface BuyingSignalItem {
  insight_id: string;
  conversation_id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  signal_text: string;
  confidence: number;
  observed_at: string;
  score: number;
  score_tier: 'hot' | 'warm' | 'cold';
  responsible_user_name: string;
  has_followup: boolean;
}

export interface LossSignalItem {
  insight_id: string;
  conversation_id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  signal_text: string;
  confidence: number;
  observed_at: string;
  responsible_user_name: string;
}

export interface PipelineStageSlice {
  stage_id: string;
  stage_name: string;
  position: number;
  deals_count: number;
  total_value: number;
}

export interface PipelineSnapshotData {
  is_snapshot: boolean;
  stages: PipelineStageSlice[];
  total_open_deals: number;
  total_open_value: number;
}

export interface SignalsAndPipelineResponse {
  buying_signals: BuyingSignalItem[];
  loss_signals: LossSignalItem[];
  pipeline_snapshot: PipelineSnapshotData;
}
