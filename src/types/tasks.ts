// ============================================================
// Tasks & Follow-up Operational Domain Types (V1.2)
// ============================================================

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskSource = 'manual' | 'intelligence' | 'automation' | 'flow';

export type ActionType =
  | 'message'
  | 'call'
  | 'proposal'
  | 'documents'
  | 'decision'
  | 'recontact'
  | 'meeting'
  | 'other';

export type WaitingOn = 'customer' | 'team' | 'external';

export type CockpitView =
  | 'today'
  | 'overdue'
  | 'upcoming'
  | 'waiting_customer'
  | 'no_next_action'
  | 'forgotten'
  | 'completed'
  | 'all';

export interface TaskAiProvenance {
  insight_id?: string;
  analysis_run_id?: string;
  model?: string;
  snippet?: string;
  suggested_action?: string;
  confidence?: number;
}

export interface Task {
  id: string;
  account_id: string;
  contact_id?: string | null;
  conversation_id?: string | null;
  deal_id?: string | null;

  assigned_user_id?: string | null;
  created_by_user_id?: string | null;
  completed_by_user_id?: string | null;

  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;

  action_type: ActionType;
  waiting_on?: WaitingOn | null;

  due_at?: string | null;
  original_due_at?: string | null;
  snoozed_until?: string | null;
  snooze_count: number;
  snooze_reason?: string | null;

  completed_at?: string | null;

  source: TaskSource;
  ai_suggestion_provenance?: TaskAiProvenance;

  // Joined / computed relations
  contact?: {
    id: string;
    name?: string | null;
    phone: string;
    avatar_url?: string | null;
  } | null;
  assigned_user?: {
    id: string;
    full_name: string;
    email: string | null;
    avatar_url?: string | null;
  } | null;

  // Cockpit enriched fields
  effective_due_at?: string | null;
  customer_replied_after_creation?: boolean;
  lead_score?: number | null;
  lead_intent?: string | null;
  lead_urgency?: string | null;
  assigned_user_name?: string | null;

  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  action_type?: ActionType;
  waiting_on?: WaitingOn | null;
  contact_id?: string | null;
  conversation_id?: string | null;
  deal_id?: string | null;
  assigned_user_id?: string | null;
  created_by_user_id?: string | null;
  due_at?: string | null;
  source?: TaskSource;
  ai_suggestion_provenance?: TaskAiProvenance;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  action_type?: ActionType;
  waiting_on?: WaitingOn | null;
  due_at?: string | null;
  assigned_user_id?: string | null;
  completed_at?: string | null;
  completed_by_user_id?: string | null;
}

export interface SnoozeTaskInput {
  snooze_until: string;
  reason?: string | null;
}

export type TaskTimeframeFilter = 'all' | 'today' | 'overdue' | 'upcoming' | 'completed';

export interface TaskFilter {
  timeframe?: TaskTimeframeFilter;
  view?: CockpitView;
  status?: TaskStatus;
  priority?: TaskPriority;
  action_type?: ActionType;
  waiting_on?: WaitingOn;
  assigned_user_id?: string | null;
  contact_id?: string | null;
  conversation_id?: string | null;
  source?: TaskSource;
  timezone?: string;
}

export interface NoNextActionLeadItem {
  contact_id: string;
  contact_name: string | null;
  contact_phone: string;
  contact_avatar_url: string | null;
  conversation_id: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  current_intent: string | null;
  urgency: string | null;
  suggested_next_action: string | null;
  suggested_due_at: string | null;
  lead_score: number | null;
  deal_id: string | null;
  deal_title: string | null;
  deal_value: number | null;
}

export interface ForgottenLeadItem {
  contact_id: string;
  contact_name: string | null;
  contact_phone: string;
  contact_avatar_url: string | null;
  conversation_id: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  unattended_since: string | null;
  lead_score: number | null;
  deal_id: string | null;
  deal_title: string | null;
  inactive_hours: number;
}
