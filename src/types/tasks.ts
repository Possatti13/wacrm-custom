// ============================================================
// Tasks & Follow-up Operational Domain Types (Phase 9)
// ============================================================

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskSource = 'manual' | 'intelligence' | 'automation' | 'flow';

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

  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;

  due_at?: string | null;
  completed_at?: string | null;

  source: TaskSource;
  ai_suggestion_provenance?: TaskAiProvenance;

  // Joined relations
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

  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
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
  due_at?: string | null;
  assigned_user_id?: string | null;
  completed_at?: string | null;
}

export type TaskTimeframeFilter = 'all' | 'today' | 'overdue' | 'upcoming' | 'completed';

export interface TaskFilter {
  timeframe?: TaskTimeframeFilter;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_user_id?: string | null;
  contact_id?: string | null;
  conversation_id?: string | null;
  source?: TaskSource;
}
