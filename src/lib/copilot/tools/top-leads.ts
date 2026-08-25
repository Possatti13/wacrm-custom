import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';

export interface TopLeadScoreResult {
  contactId: string;
  contactName: string;
  contactPhone: string;
  score: number;
  tier: string;
  currentIntent: string;
  urgency: string;
  updatedAt: string;
}

interface ScoreLeadRow {
  contact_id: string;
  score: number;
  updated_at: string;
  contacts?: { id: string; name: string; phone: string } | null;
  contact_lead_profiles?: { current_intent?: string | null; urgency?: string | null } | null;
}

export async function getTopLeadScores(
  db: SupabaseClient,
  accountId: string,
  limit = 10
): Promise<{
  leads: TopLeadScoreResult[];
  count: number;
}> {
  const validAccId = validateUuid(accountId, 'accountId');

  const { data: scoresData } = await db
    .from('contact_lead_scores')
    .select(`
      contact_id,
      score,
      updated_at,
      contacts (id, name, phone),
      contact_lead_profiles (current_intent, urgency)
    `)
    .eq('account_id', validAccId)
    .order('score', { ascending: false })
    .limit(limit);

  const rows = (scoresData || []) as unknown as ScoreLeadRow[];
  const leads: TopLeadScoreResult[] = rows.map((row) => {
    const score = row.score || 0;
    const tier = score >= 80 ? 'hot' : score >= 50 ? 'warm' : 'cold';
    return {
      contactId: row.contacts?.id || row.contact_id,
      contactName: row.contacts?.name || 'Cliente',
      contactPhone: row.contacts?.phone || '',
      score,
      tier,
      currentIntent: row.contact_lead_profiles?.current_intent || 'Não informado',
      urgency: row.contact_lead_profiles?.urgency || 'Normal',
      updatedAt: row.updated_at,
    };
  });

  return {
    leads,
    count: leads.length,
  };
}
