import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskFilter } from '@/types/tasks';

/**
 * Enriches tasks with assigned user profile data scoped strictly to the current account.
 * Since `tasks.assigned_user_id` and `tasks.created_by_user_id` reference `auth.users(id)`
 * rather than a direct PostgREST FK to `public.profiles`, we load matching profiles
 * in a tenant-isolated secondary query to avoid PGRST200 schema cache lookup failures.
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
        .flatMap((t) => [t.assigned_user_id, t.created_by_user_id])
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    )
  );

  if (userIds.length === 0) {
    return tasks.map((t) => ({
      ...t,
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
      contact:contacts(id, name, phone, avatar_url)
    `)
    .single();

  if (error) {
    throw new Error(`updateTask failed: ${error.message}`);
  }

  const [enriched] = await attachTaskProfiles(db, accountId, [data]);
  return enriched;
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
