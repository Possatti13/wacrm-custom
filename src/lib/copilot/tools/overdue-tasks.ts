import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';

export interface OverdueTaskResult {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  dueAt: string;
  contactName: string | null;
  dealTitle: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  due_at: string;
  contacts?: { name: string } | null;
  deals?: { title: string } | null;
}

export async function getOverdueTasks(
  db: SupabaseClient,
  accountId: string,
  limit = 15
): Promise<{
  tasks: OverdueTaskResult[];
  count: number;
}> {
  const validAccId = validateUuid(accountId, 'accountId');
  const nowIso = new Date().toISOString();

  const { data: tasksData } = await db
    .from('tasks')
    .select(`
      id,
      title,
      description,
      priority,
      due_at,
      contacts (name),
      deals (title)
    `)
    .eq('account_id', validAccId)
    .eq('status', 'pending')
    .lt('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(limit);

  const rows = (tasksData || []) as unknown as TaskRow[];
  const tasks: OverdueTaskResult[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority || 'medium',
    dueAt: t.due_at,
    contactName: t.contacts?.name || null,
    dealTitle: t.deals?.title || null,
  }));

  return {
    tasks,
    count: tasks.length,
  };
}
