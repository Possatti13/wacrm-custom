import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilter } from '@/types/tasks';

export async function listTasks(
  db: SupabaseClient,
  accountId: string,
  filter?: TaskFilter
): Promise<Task[]> {
  let query = db
    .from('tasks')
    .select(`
      *,
      contact:contacts(id, name, phone, avatar_url),
      assigned_user:profiles!tasks_assigned_user_id_fkey(id, full_name, email, avatar_url)
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

  return (data || []) as unknown as Task[];
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
      contact:contacts(id, name, phone, avatar_url),
      assigned_user:profiles!tasks_assigned_user_id_fkey(id, full_name, email, avatar_url)
    `)
    .eq('account_id', accountId)
    .eq('id', taskId)
    .maybeSingle();

  if (error) {
    throw new Error(`getTaskById failed: ${error.message}`);
  }

  return (data as unknown as Task) || null;
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
    contact_id: input.contact_id || null,
    conversation_id: input.conversation_id || null,
    deal_id: input.deal_id || null,
    assigned_user_id: input.assigned_user_id || null,
    created_by_user_id: input.created_by_user_id || null,
    due_at: input.due_at || null,
    source: input.source || 'manual',
    ai_suggestion_provenance: input.ai_suggestion_provenance || {},
  };

  const { data, error } = await db
    .from('tasks')
    .insert(payload)
    .select(`
      *,
      contact:contacts(id, name, phone, avatar_url),
      assigned_user:profiles!tasks_assigned_user_id_fkey(id, full_name, email, avatar_url)
    `)
    .single();

  if (error) {
    throw new Error(`createTask failed: ${error.message}`);
  }

  return data as unknown as Task;
}

export async function updateTask(
  db: SupabaseClient,
  accountId: string,
  taskId: string,
  updates: UpdateTaskInput
): Promise<Task> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) payload.title = updates.title.trim();
  if (updates.description !== undefined) payload.description = updates.description?.trim() || null;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.status !== undefined) {
    payload.status = updates.status;
    if (updates.status === 'completed' && updates.completed_at === undefined) {
      payload.completed_at = new Date().toISOString();
    } else if (updates.status !== 'completed') {
      payload.completed_at = null;
    }
  }
  if (updates.due_at !== undefined) payload.due_at = updates.due_at;
  if (updates.assigned_user_id !== undefined) payload.assigned_user_id = updates.assigned_user_id;
  if (updates.completed_at !== undefined) payload.completed_at = updates.completed_at;

  const { data, error } = await db
    .from('tasks')
    .update(payload)
    .eq('account_id', accountId)
    .eq('id', taskId)
    .select(`
      *,
      contact:contacts(id, name, phone, avatar_url),
      assigned_user:profiles!tasks_assigned_user_id_fkey(id, full_name, email, avatar_url)
    `)
    .single();

  if (error) {
    throw new Error(`updateTask failed: ${error.message}`);
  }

  return data as unknown as Task;
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
