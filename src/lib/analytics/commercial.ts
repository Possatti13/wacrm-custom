import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CommercialAnalyticsSummary,
  LeadScoreDistribution,
  ObjectionAnalyticsItem,
  CatalogInterestAnalyticsItem,
  TasksAnalyticsSummary,
} from '@/types/analytics';

export async function loadCommercialAnalytics(
  db: SupabaseClient,
  accountId: string
): Promise<CommercialAnalyticsSummary> {
  const [scoresRes, objectionsRes, interestsRes, tasksRes] = await Promise.all([
    // 1. Lead Scores
    db
      .from('contact_lead_scores')
      .select('score')
      .eq('account_id', accountId),

    // 2. Contact Objections
    db
      .from('contact_objections')
      .select('objection, status')
      .eq('account_id', accountId),

    // 3. Catalog Interests
    db
      .from('contact_catalog_interests')
      .select(`
        catalog_item_id,
        item:catalog_items!contact_catalog_interests_catalog_item_id_fkey(id, name, type)
      `)
      .eq('account_id', accountId),

    // 4. Tasks
    db
      .from('tasks')
      .select('id, status, due_date, completed_at')
      .eq('account_id', accountId),
  ]);

  // Compute Lead Score Distribution
  const rawScores = (scoresRes.data || []).map((s: { score: number }) => Number(s.score) || 0);
  const totalScored = rawScores.length;
  const avgScore =
    totalScored > 0
      ? Math.round(rawScores.reduce((acc, v) => acc + v, 0) / totalScored)
      : 0;

  let hotCount = 0;
  let warmCount = 0;
  let coldCount = 0;

  for (const score of rawScores) {
    if (score >= 70) hotCount++;
    else if (score >= 40) warmCount++;
    else coldCount++;
  }

  const leadScores: LeadScoreDistribution = {
    totalScored,
    avgScore,
    hotCount,
    warmCount,
    coldCount,
  };

  // Compute Top Objections
  const rawObjections = objectionsRes.data || [];
  const objMap = new Map<string, { total: number; open: number; resolved: number }>();

  for (const item of rawObjections) {
    const key = (item.objection || 'Geral').trim();
    const existing = objMap.get(key) || { total: 0, open: 0, resolved: 0 };
    existing.total += 1;
    if (item.status === 'resolved') {
      existing.resolved += 1;
    } else {
      existing.open += 1;
    }
    objMap.set(key, existing);
  }

  const topObjections: ObjectionAnalyticsItem[] = Array.from(objMap.entries())
    .map(([objection, counts]) => ({
      objection,
      totalCount: counts.total,
      openCount: counts.open,
      resolvedCount: counts.resolved,
      resolutionRate:
        counts.total > 0 ? Math.round((counts.resolved / counts.total) * 100) : 0,
    }))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 5);

  // Compute Top Catalog Interests
  const rawInterests = interestsRes.data || [];
  const interestMap = new Map<
    string,
    { id: string; name: string; type: string; count: number }
  >();

  for (const row of rawInterests as unknown as { catalog_item_id: string; item: { id: string; name: string; type: string } | null }[]) {
    if (!row.item) continue;
    const existing = interestMap.get(row.item.id) || {
      id: row.item.id,
      name: row.item.name,
      type: row.item.type,
      count: 0,
    };
    existing.count += 1;
    interestMap.set(row.item.id, existing);
  }

  const topInterests: CatalogInterestAnalyticsItem[] = Array.from(
    interestMap.values()
  )
    .map((v) => ({
      itemId: v.id,
      itemName: v.name,
      itemType: v.type,
      interestCount: v.count,
    }))
    .sort((a, b) => b.interestCount - a.interestCount)
    .slice(0, 5);

  // Compute Tasks Summary
  const rawTasks = tasksRes.data || [];
  const now = new Date();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));

  let pending = 0;
  let overdue = 0;
  let completedToday = 0;

  for (const task of rawTasks) {
    if (task.status === 'completed') {
      if (task.completed_at && new Date(task.completed_at) >= startOfToday) {
        completedToday++;
      }
    } else {
      pending++;
      if (task.due_date && new Date(task.due_date) < now) {
        overdue++;
      }
    }
  }

  const tasks: TasksAnalyticsSummary = {
    pending,
    overdue,
    completedToday,
  };

  return {
    leadScores,
    topObjections,
    topInterests,
    tasks,
  };
}
