import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';

export interface ScoreExplanationItem {
  component: string;
  points: number;
  description: string;
}

export interface ScoreExplanationResult {
  contactId: string;
  contactName: string;
  totalScore: number;
  tier: string;
  breakdown: ScoreExplanationItem[];
  explanationText: string;
}

interface ScoreRow {
  score: number;
  breakdown: {
    base?: number;
    intent?: number;
    urgency?: number;
    interests?: number;
    rules?: Array<{ rule_name?: string; points?: number; description?: string }>;
  } | null;
  contacts?: { name: string } | null;
  contact_lead_profiles?: { current_intent?: string | null; urgency?: string | null } | null;
}

export async function explainLeadScore(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ScoreExplanationResult> {
  const validAccId = validateUuid(accountId, 'accountId');
  const validContactId = validateUuid(contactId, 'contactId');

  const { data: scoreData } = await db
    .from('contact_lead_scores')
    .select(`
      score,
      breakdown,
      contacts (name),
      contact_lead_profiles (current_intent, urgency)
    `)
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .maybeSingle();

  const row = scoreData as unknown as ScoreRow | null;
  const contactName = row?.contacts?.name || 'Cliente';
  const totalScore = row?.score || 0;
  const tier = totalScore >= 80 ? 'hot' : totalScore >= 50 ? 'warm' : 'cold';
  const rawBreakdown = row?.breakdown || {};

  const items: ScoreExplanationItem[] = [];

  if (rawBreakdown.base !== undefined) {
    items.push({
      component: 'Pontuação Base',
      points: rawBreakdown.base,
      description: 'Ponto de partida configurado para novos leads cadastrados.',
    });
  }
  if (rawBreakdown.intent !== undefined) {
    items.push({
      component: 'Intenção Comercial',
      points: rawBreakdown.intent,
      description: `Intenção detectada: ${row?.contact_lead_profiles?.current_intent || 'informada'}`,
    });
  }
  if (rawBreakdown.urgency !== undefined) {
    items.push({
      component: 'Nível de Urgência',
      points: rawBreakdown.urgency,
      description: `Urgência detectada: ${row?.contact_lead_profiles?.urgency || 'informada'}`,
    });
  }
  if (rawBreakdown.interests !== undefined) {
    items.push({
      component: 'Interesse em Catálogo',
      points: rawBreakdown.interests,
      description: 'Interesses ativos em produtos ou serviços do catálogo.',
    });
  }
  if (Array.isArray(rawBreakdown.rules)) {
    for (const r of rawBreakdown.rules) {
      items.push({
        component: r.rule_name || 'Regra Comercial',
        points: r.points || 0,
        description: r.description || 'Critério de pontuação atendido.',
      });
    }
  }

  // Generate plain deterministic explanation text
  const itemTexts = items.map(
    (it) => `• **${it.component}**: ${it.points >= 0 ? '+' : ''}${it.points} pts (${it.description})`
  );

  const explanationText = `🎯 **Explicação da Pontuação de ${contactName}:**\n\n` +
    `• **Score Total**: **${totalScore}/100** (Classificação: **${tier.toUpperCase()}**)\n\n` +
    `**Detalhamento dos Fatores:**\n${itemTexts.length > 0 ? itemTexts.join('\n') : '• Sem fatores adicionais ponderados.'}`;

  return {
    contactId: validContactId,
    contactName,
    totalScore,
    tier,
    breakdown: items,
    explanationText,
  };
}
