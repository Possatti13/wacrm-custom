import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';
import { searchContactsByCatalogItem } from './tools/catalog-search';
import { getTopLeadScores } from './tools/top-leads';
import { getOverdueTasks } from './tools/overdue-tasks';
import { getPipelineStageCounts } from './tools/pipeline-counts';
import { getUnansweredConversations } from './tools/unanswered';
import { searchMessageMentions } from './tools/message-mentions';
import { explainLeadScore } from './tools/explain-score';
import { executeOnDemandAiAction } from '@/lib/intelligence/on-demand';

export interface CopilotQueryResult {
  responseText: string;
  source: 'deterministic_tool' | 'on_demand_llm';
  toolName: string | null;
  llmCalls: number;
  cached?: boolean;
  data?: unknown;
}

export async function routeCopilotQuery(
  db: SupabaseClient,
  accountId: string,
  query: string,
  context?: {
    contactId?: string | null;
    conversationId?: string | null;
    userId?: string | null;
  }
): Promise<CopilotQueryResult> {
  const validAccId = validateUuid(accountId, 'accountId');
  const cleanQuery = query.trim();
  const lower = cleanQuery.toLowerCase();

  // 1. Explain Score Intent
  if (
    context?.contactId &&
    (/(?:por que|qual o motivo|explicar|como foi calculado|motivo d[ao])\s+(?:o\s+)?score/i.test(lower) ||
      lower.includes('explicar score') ||
      lower.includes('por que o score'))
  ) {
    const res = await explainLeadScore(db, validAccId, context.contactId);
    return {
      responseText: res.explanationText,
      source: 'deterministic_tool',
      toolName: 'explainLeadScore',
      llmCalls: 0,
      data: res,
    };
  }

  // 2. Overdue Tasks Intent
  if (
    /(?:tarefas|pendências)\s+(?:atrasadas|vencidas|pendentes)/i.test(lower) ||
    lower.includes('quais tarefas estão atrasadas') ||
    lower.includes('tarefas vencidas')
  ) {
    const res = await getOverdueTasks(db, validAccId, 10);
    let text = '';
    if (res.count === 0) {
      text = '🎉 Nenhuma tarefa em atraso no momento! Todas as atividades estão em dia.';
    } else {
      const items = res.tasks.map(
        (t) =>
          `• **${t.title}** (Prioridade: ${t.priority.toUpperCase()}) — Venceu em ${new Date(t.dueAt).toLocaleDateString('pt-BR')}${
            t.contactName ? ` | Cliente: ${t.contactName}` : ''
          }`
      );
      text = `📋 Encontrei **${res.count} tarefa(s) atrasada(s)**:\n\n${items.join('\n')}`;
    }

    return {
      responseText: text,
      source: 'deterministic_tool',
      toolName: 'getOverdueTasks',
      llmCalls: 0,
      data: res,
    };
  }

  // 3. Top Lead Scores Intent
  if (
    /(?:maior|maiores|top|melhores|quentes)\s+(?:score|scores|leads|oportunidades)/i.test(lower) ||
    lower.includes('maior lead score') ||
    lower.includes('top leads')
  ) {
    const res = await getTopLeadScores(db, validAccId, 10);
    let text = '';
    if (res.count === 0) {
      text = 'Nenhum lead com pontuação calculada encontrado.';
    } else {
      const items = res.leads.map(
        (l, idx) =>
          `${idx + 1}. **${l.contactName}** — **${l.score}/100** (${l.tier.toUpperCase()}) | Intenção: ${l.currentIntent} | Urgência: ${l.urgency}`
      );
      text = `🔥 **Top Leads por Pontuação Comercial:**\n\n${items.join('\n')}`;
    }

    return {
      responseText: text,
      source: 'deterministic_tool',
      toolName: 'getTopLeadScores',
      llmCalls: 0,
      data: res,
    };
  }

  // 4. Pipeline Stage Counts Intent
  if (
    /(?:quantas oportunidades|etapas? do funil|funil de vendas|contagem por etapa)/i.test(lower) ||
    lower.includes('oportunidades em cada etapa') ||
    lower.includes('funil')
  ) {
    const res = await getPipelineStageCounts(db, validAccId);
    let text = '';
    if (!res || res.stages.length === 0) {
      text = 'Nenhuma oportunidade ativa ou pipeline cadastrado no momento.';
    } else {
      const items = res.stages.map(
        (s) =>
          `• **${s.stageName}**: ${s.dealCount} negócio(s) — Total: R$ ${s.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
      text = `📊 **Distribuição do Funil de Vendas** (${res.totalDeals} negócios | R$ ${res.totalPipelineValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}):\n\n${items.join('\n')}`;
    }

    return {
      responseText: text,
      source: 'deterministic_tool',
      toolName: 'getPipelineStageCounts',
      llmCalls: 0,
      data: res,
    };
  }

  // 5. Unanswered Conversations Intent
  if (
    /(?:aguardando resposta|não respondid[ao]s?|sem resposta|esperando)/i.test(lower) ||
    lower.includes('quem está aguardando') ||
    lower.includes('clientes sem resposta')
  ) {
    const res = await getUnansweredConversations(db, validAccId, 10);
    let text = '';
    if (res.count === 0) {
      text = '✅ Todos os clientes foram respondidos! Nenhuma conversa aguardando retorno.';
    } else {
      const items = res.conversations.map(
        (c) => `• **${c.contactName}** (${c.contactPhone}): "${c.lastMessageText}"`
      );
      text = `⏳ **${res.count} conversa(s) aguardando resposta da equipe:**\n\n${items.join('\n')}`;
    }

    return {
      responseText: text,
      source: 'deterministic_tool',
      toolName: 'getUnansweredConversations',
      llmCalls: 0,
      data: res,
    };
  }

  // 6. Specific Message Mentions Intent
  const mentionMatch = lower.match(/(?:quem falou|quem disse|quem mencionou)\s+["']?([^"'\?]+)["']?/i);
  if (mentionMatch && mentionMatch[1]) {
    const keyword = mentionMatch[1].trim();
    const res = await searchMessageMentions(db, validAccId, keyword, 10);
    let text = '';
    if (res.count === 0) {
      text = `Nenhuma mensagem encontrada mencionando o termo "${keyword}".`;
    } else {
      const items = res.mentions.map(
        (m) => `• **${m.contactName}**: "${m.textContent}" (${new Date(m.createdAt).toLocaleDateString('pt-BR')})`
      );
      text = `💬 Encontrei **${res.count} menção(ões)** para "${keyword}":\n\n${items.join('\n')}`;
    }

    return {
      responseText: text,
      source: 'deterministic_tool',
      toolName: 'searchMessageMentions',
      llmCalls: 0,
      data: res,
    };
  }

  // 7. Catalog Search Intent (e.g. "Quem perguntou da Falcon?", "Quem falou de X-13?")
  const catalogMatch = lower.match(
    /(?:quem|quais clientes|alguém)\s+(?:perguntou|falou|tem interesse|quer|procura|mencionou|pediu)\s+(?:d[eoa]s?|sobre)?\s*([a-z0-9\-_ ]+)/i
  );
  if (catalogMatch && catalogMatch[1]) {
    const term = catalogMatch[1].trim().replace(/\?+$/, '');
    const res = await searchContactsByCatalogItem(db, validAccId, term);
    let text = '';
    if (res.count === 0) {
      text = `Nenhum cliente com interesse registrado no item "${term}".`;
    } else {
      const items = res.contacts.map(
        (c) => `• **${c.contactName}** (${c.contactPhone}) — Status: ${(c.status || 'ativo').toUpperCase()}`
      );
      text = `🎯 Encontrei **${res.count} cliente(s)** interessados em **${res.resolvedItemName || term}**:\n\n${items.join('\n')}`;
    }

    return {
      responseText: text,
      source: 'deterministic_tool',
      toolName: 'searchContactsByCatalogItem',
      llmCalls: 0,
      data: res,
    };
  }

  // 8. Interpretive Query $\rightarrow$ Route to On-Demand LLM Engine with Caching
  const aiResult = await executeOnDemandAiAction(db, {
    accountId: validAccId,
    userId: context?.userId || null,
    targetType: context?.conversationId ? 'conversation' : 'query',
    targetId: context?.conversationId || null,
    actionType: 'copilot_query',
    queryText: cleanQuery,
  });

  return {
    responseText: aiResult.request.result_text || 'Análise concluída.',
    source: 'on_demand_llm',
    toolName: null,
    llmCalls: aiResult.cached ? 0 : 1,
    cached: aiResult.cached,
    data: aiResult.request.result_json,
  };
}
