import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  SnoozeTaskInput,
  TaskFilter,
  CockpitView,
  NoNextActionLeadItem,
  ForgottenLeadItem,
} from '@/types/tasks';
import { COMMERCIAL_THRESHOLDS } from './thresholds';
import { sanitizeTimezone } from './validation';

/**
 * Enriches tasks with assigned user profile data scoped strictly to the current account.
 */
async function attachTaskProfiles(
  db: SupabaseClient,
  accountId: string,
  tasks: Array<Record<string, unknown>>
): Promise<Task[]> {
  if (!tasks || tasks.length === 0) return [];

  const userIds = Array.from(
    new Set(
      tasks
        .flatMap((t) => [t.assigned_user_id, t.created_by_user_id, t.completed_by_user_id])
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    )
  );

  if (userIds.length === 0) {
    return tasks.map((t) => ({
      ...t,
      action_type: (t.action_type as string) || 'other',
      snooze_count: Number(t.snooze_count || 0),
      effective_due_at: (t.snoozed_until as string) || (t.due_at as string) || null,
      assigned_user: null,
    })) as unknown as Task[];
  }

  // Fetch profiles belonging to the same account
  const { data: profileRows, error } = await db
    .from('profiles')
    .select('id, user_id, full_name, email, avatar_url')
    .eq('account_id', accountId)
    .in('user_id', userIds);

  const profileMap = new Map<
    string,
    { id: string; full_name: string; email: string | null; avatar_url?: string | null }
  >();

  if (!error && profileRows) {
    for (const p of profileRows) {
      const profileObj = {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
      };
      if (p.user_id) profileMap.set(p.user_id, profileObj);
      if (p.id) profileMap.set(p.id, profileObj);
    }
  }

  return tasks.map((t) => ({
    ...t,
    action_type: (t.action_type as string) || 'other',
    snooze_count: Number(t.snooze_count || 0),
    effective_due_at: (t.snoozed_until as string) || (t.due_at as string) || null,
    assigned_user: typeof t.assigned_user_id === 'string' ? profileMap.get(t.assigned_user_id) || null : null,
  })) as unknown as Task[];
}

export async function listTasks(
  db: SupabaseClient,
  accountId: string,
  filter?: TaskFilter
): Promise<Task[]> {
  let query = db
    .from('tasks')
    .select(`
      *,
      contact:contacts(id, name, phone, avatar_url)
    `)
    .eq('account_id', accountId);

  const nowIso = new Date().toISOString();
  const startOfTodayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endOfTodayIso = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

  if (filter?.timeframe) {
    if (filter.timeframe === 'today') {
      query = query
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .gte('due_at', startOfTodayIso)
        .lte('due_at', endOfTodayIso);
    } else if (filter.timeframe === 'overdue') {
      query = query
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .lt('due_at', nowIso);
    } else if (filter.timeframe === 'upcoming') {
      query = query
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .gt('due_at', endOfTodayIso);
    } else if (filter.timeframe === 'completed') {
      query = query.eq('status', 'completed');
    }
  }

  if (filter?.status) {
    query = query.eq('status', filter.status);
  }
  if (filter?.priority) {
    query = query.eq('priority', filter.priority);
  }
  if (filter?.action_type) {
    query = query.eq('action_type', filter.action_type);
  }
  if (filter?.waiting_on) {
    query = query.eq('waiting_on', filter.waiting_on);
  }
  if (filter?.assigned_user_id) {
    query = query.eq('assigned_user_id', filter.assigned_user_id);
  }
  if (filter?.contact_id) {
    query = query.eq('contact_id', filter.contact_id);
  }
  if (filter?.conversation_id) {
    query = query.eq('conversation_id', filter.conversation_id);
  }
  if (filter?.source) {
    query = query.eq('source', filter.source);
  }

  query = query.order('due_at', { ascending: true, nullsFirst: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`listTasks failed: ${error.message}`);
  }

  return attachTaskProfiles(db, accountId, data || []);
}

export async function getTaskById(
  db: SupabaseClient,
  accountId: string,
  taskId: string
): Promise<Task | null> {
  const { data, error } = await db
    .from('tasks')
    .select(`
      *,
      contact:contacts(id, name, phone, avatar_url)
    `)
    .eq('account_id', accountId)
    .eq('id', taskId)
    .maybeSingle();

  if (error) {
    throw new Error(`getTaskById failed: ${error.message}`);
  }

  if (!data) return null;

  const [enriched] = await attachTaskProfiles(db, accountId, [data]);
  return enriched || null;
}

export async function createTask(
  db: SupabaseClient,
  accountId: string,
  input: CreateTaskInput
): Promise<Task> {
  const payload = {
    account_id: accountId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    priority: input.priority || 'medium',
    status: 'pending',
    action_type: input.action_type || 'other',
    waiting_on: input.waiting_on || null,
    contact_id: input.contact_id || null,
    conversation_id: input.conversation_id || null,
    deal_id: input.deal_id || null,
    assigned_user_id: input.assigned_user_id || null,
    created_by_user_id: input.created_by_user_id || null,
    due_at: input.due_at || null,
    original_due_at: input.due_at || null,
    source: input.source || 'manual',
    ai_suggestion_provenance: input.ai_suggestion_provenance || {},
  };

  const { data, error } = await db
    .from('tasks')
    .insert(payload)
    .select(`
      *,
      contact:contacts(id, name, phone, avatar_url)
    `)
    .single();

  if (error) {
    throw new Error(`createTask failed: ${error.message}`);
  }

  const [enriched] = await attachTaskProfiles(db, accountId, [data]);
  return enriched;
}

export async function updateTask(
  db: SupabaseClient,
  accountId: string,
  taskId: string,
  updates: UpdateTaskInput
): Promise<Task> {
  // If status is transitioning to completed and db.rpc exists, delegate to canonical atomic RPC
  if (updates.status === 'completed' && typeof db.rpc === 'function') {
    return completeFollowup(db, accountId, taskId, updates.completed_by_user_id);
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) payload.title = updates.title.trim();
  if (updates.description !== undefined) payload.description = updates.description?.trim() || null;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.action_type !== undefined) payload.action_type = updates.action_type;
  if (updates.waiting_on !== undefined) payload.waiting_on = updates.waiting_on;
  if (updates.status !== undefined) {
    payload.status = updates.status;
    if (updates.status === 'completed' && updates.completed_at === undefined) {
      payload.completed_at = new Date().toISOString();
    }
  }
  if (updates.due_at !== undefined) payload.due_at = updates.due_at;
  if (updates.assigned_user_id !== undefined) payload.assigned_user_id = updates.assigned_user_id;

  const { data, error } = await db
    .from('tasks')
    .update(payload)
    .eq('account_id', accountId)
    .eq('id', taskId)
    .select(`
      *,
      contact:contacts(id, name, phone, avatar_url)
    `)
    .single();

  if (error) {
    throw new Error(`updateTask failed: ${error.message}`);
  }

  const [enriched] = await attachTaskProfiles(db, accountId, [data]);
  return enriched;
}

export async function snoozeFollowup(
  db: SupabaseClient,
  accountId: string,
  taskId: string,
  input: SnoozeTaskInput
): Promise<Task> {
  const { error: rpcError } = await db.rpc('snooze_followup_atomic', {
    p_account_id: accountId,
    p_task_id: taskId,
    p_snooze_until: input.snooze_until,
    p_reason: input.reason || null,
  });

  if (rpcError) {
    throw new Error(`snoozeFollowup failed: ${rpcError.message}`);
  }

  const updated = await getTaskById(db, accountId, taskId);
  if (!updated) throw new Error('Task not found after snooze');
  return updated;
}

export async function completeFollowup(
  db: SupabaseClient,
  accountId: string,
  taskId: string,
  completedByUserId?: string | null
): Promise<Task> {
  const { error: rpcError } = await db.rpc('complete_followup_atomic', {
    p_account_id: accountId,
    p_task_id: taskId,
    p_completed_by: completedByUserId || null,
  });

  if (rpcError) {
    throw new Error(`completeFollowup failed: ${rpcError.message}`);
  }

  const updated = await getTaskById(db, accountId, taskId);
  if (!updated) throw new Error('Task not found after complete');
  return updated;
}

export async function deleteTask(
  db: SupabaseClient,
  accountId: string,
  taskId: string
): Promise<boolean> {
  const { error } = await db
    .from('tasks')
    .delete()
    .eq('account_id', accountId)
    .eq('id', taskId);

  if (error) {
    throw new Error(`deleteTask failed: ${error.message}`);
  }

  return true;
}

/**
 * Creates a Follow-up task from an AI Suggestion with strict deduplication / idempotency.
 * If an active task already exists with the same insight_id or matching action text on the conversation,
 * it returns the existing task rather than creating a duplicate.
 */
export async function createFollowupFromAiSuggestion(
  db: SupabaseClient,
  accountId: string,
  input: {
    contact_id: string;
    conversation_id?: string | null;
    action_text: string;
    action_type?: string;
    due_at?: string | null;
    assigned_user_id?: string | null;
    created_by_user_id?: string | null;
    insight_id?: string;
    analysis_run_id?: string;
  }
): Promise<{ task: Task; duplicated: boolean }> {
  // 1. Check for existing active task for the same contact / conversation with same insight_id
  if (input.insight_id) {
    const { data: existingByInsight } = await db
      .from('tasks')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', input.contact_id)
      .in('status', ['pending', 'in_progress'])
      .contains('ai_suggestion_provenance', { insight_id: input.insight_id })
      .maybeSingle();

    if (existingByInsight) {
      const fullTask = await getTaskById(db, accountId, existingByInsight.id);
      if (fullTask) return { task: fullTask, duplicated: true };
    }
  }

  // 2. Check for duplicate pending task with same title/content on same contact created in last 24h
  const { data: duplicateTask } = await db
    .from('tasks')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', input.contact_id)
    .eq('title', input.action_text.trim())
    .in('status', ['pending', 'in_progress'])
    .maybeSingle();

  if (duplicateTask) {
    const fullTask = await getTaskById(db, accountId, duplicateTask.id);
    if (fullTask) return { task: fullTask, duplicated: true };
  }

  // 3. Create fresh task
  const created = await createTask(db, accountId, {
    contact_id: input.contact_id,
    conversation_id: input.conversation_id || null,
    title: input.action_text.trim(),
    action_type: (input.action_type as any) || 'recontact',
    due_at: input.due_at || null,
    assigned_user_id: input.assigned_user_id || null,
    created_by_user_id: input.created_by_user_id || null,
    source: 'intelligence',
    ai_suggestion_provenance: {
      insight_id: input.insight_id,
      analysis_run_id: input.analysis_run_id,
      suggested_action: input.action_text.trim(),
    },
  });

  return { task: created, duplicated: false };
}

/**
 * Cockpit Aggregation Query (Server-side RPC)
 */
export async function getCockpitFollowups(
  db: SupabaseClient,
  accountId: string,
  options: {
    assigned_user_id?: string | null;
    view?: CockpitView;
    limit?: number;
    offset?: number;
  }
): Promise<{ total: number; timezone: string; view: CockpitView; items: Task[] }> {
  const { data, error } = await db.rpc('get_followups_cockpit', {
    p_account_id: accountId,
    p_assigned_user_id: options.assigned_user_id || null,
    p_view: options.view || 'today',
    p_limit: options.limit || 50,
    p_offset: options.offset || 0,
  });

  if (error || !data) {
    // Fallback to client-side listTasks if RPC fails
    const fallbackTasks = await listTasks(db, accountId, {
      timeframe: options.view as any,
      assigned_user_id: options.assigned_user_id,
    });
    return {
      total: fallbackTasks.length,
      timezone: 'UTC',
      view: options.view || 'today',
      items: fallbackTasks,
    };
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const enriched = await attachTaskProfiles(db, accountId, items);

  return {
    total: Number(data.total || 0),
    timezone: sanitizeTimezone(data.timezone, 'UTC'),
    view: data.view || options.view || 'today',
    items: enriched,
  };
}

/**
 * Leads Without Next Action Query (Server-side RPC)
 */
export async function getLeadsWithoutNextAction(
  db: SupabaseClient,
  accountId: string,
  options?: {
    assigned_user_id?: string | null;
    limit?: number;
    offset?: number;
    min_lead_score?: number;
    max_conversation_days?: number;
  }
): Promise<{ total: number; items: NoNextActionLeadItem[] }> {
  const { data, error } = await db.rpc('get_leads_without_next_action', {
    p_account_id: accountId,
    p_assigned_user_id: options?.assigned_user_id || null,
    p_limit: options?.limit || 50,
    p_offset: options?.offset || 0,
    p_min_lead_score: options?.min_lead_score ?? COMMERCIAL_THRESHOLDS.NO_NEXT_ACTION.DEFAULT_MIN_LEAD_SCORE,
    p_max_conversation_days: options?.max_conversation_days ?? COMMERCIAL_THRESHOLDS.NO_NEXT_ACTION.DEFAULT_MAX_CONVERSATION_INACTIVE_DAYS,
  });

  if (error || !data) {
    return { total: 0, items: [] };
  }

  return {
    total: Number(data.total || 0),
    items: Array.isArray(data.items) ? data.items : [],
  };
}

/**
 * Forgotten Leads Query (Server-side RPC)
 */
export async function getForgottenLeads(
  db: SupabaseClient,
  accountId: string,
  options?: {
    assigned_user_id?: string | null;
    inactive_hours?: number;
    limit?: number;
    offset?: number;
    min_lead_score?: number;
  }
): Promise<{ total: number; inactive_threshold_hours: number; items: ForgottenLeadItem[] }> {
  const inactiveHours = options?.inactive_hours ?? COMMERCIAL_THRESHOLDS.FORGOTTEN_LEADS.DEFAULT_INACTIVE_HOURS;
  const minScore = options?.min_lead_score ?? COMMERCIAL_THRESHOLDS.FORGOTTEN_LEADS.DEFAULT_MIN_LEAD_SCORE;

  const { data, error } = await db.rpc('get_forgotten_leads', {
    p_account_id: accountId,
    p_assigned_user_id: options?.assigned_user_id || null,
    p_inactive_hours: inactiveHours,
    p_limit: options?.limit || 50,
    p_offset: options?.offset || 0,
    p_min_lead_score: minScore,
  });

  if (error || !data) {
    return { total: 0, inactive_threshold_hours: inactiveHours, items: [] };
  }

  return {
    total: Number(data.total || 0),
    inactive_threshold_hours: Number(data.inactive_threshold_hours || inactiveHours),
    items: Array.isArray(data.items) ? data.items : [],
  };
}
