/**
 * Ciclopes V1.4 — Central Metric Definitions & Contracts
 * 
 * Formal contract definitions for every single KPI displayed in the Manager Cockpit.
 * Ensures zero ambiguity, zero fake precision, and 100% mathematical auditability.
 */

export interface MetricDefinition {
  key: string;
  label: string;
  definition: string;
  sourceTable: string;
  timeField: string | null;
  denominator: string | null;
  roleScope: 'owner_admin' | 'all';
  limitations: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  active_leads: {
    key: 'active_leads',
    label: 'Leads Ativos',
    definition: 'Contatos únicos com conversas que registraram atividade (mensagens ou atualizações) dentro do período selecionado.',
    sourceTable: 'conversations',
    timeField: 'updated_at',
    denominator: 'Total no período anterior (para cálculo de variação %)',
    roleScope: 'owner_admin',
    limitations: 'Calculado a partir de conversas atualizadas no período. Não reflete necessariamente novas entradas.',
  },
  hot_leads: {
    key: 'hot_leads',
    label: 'Leads Quentes',
    definition: 'Contatos cujo lead score atual é maior ou igual a 70 pontos (Score >= 70).',
    sourceTable: 'contact_lead_scores',
    timeField: null,
    denominator: null,
    roleScope: 'owner_admin',
    limitations: 'Métrica de snapshot baseada na regra determinística de lead scoring ativa.',
  },
  overdue_followups: {
    key: 'overdue_followups',
    label: 'Follow-ups Atrasados',
    definition: 'Tarefas de acompanhamento abertas (status = pending) cuja data limite (due_at) é anterior ao momento atual no timezone do tenant.',
    sourceTable: 'tasks',
    timeField: 'due_at',
    denominator: 'Total de follow-ups atrasados no corte do período anterior',
    roleScope: 'owner_admin',
    limitations: 'Considera apenas tarefas ativas e não concluídas.',
  },
  leads_without_next_action: {
    key: 'leads_without_next_action',
    label: 'Leads Sem Próxima Ação',
    definition: 'Contatos com conversas comerciais abertas que não possuem nenhuma tarefa de follow-up pendente associada.',
    sourceTable: 'conversations + tasks',
    timeField: null,
    denominator: null,
    roleScope: 'owner_admin',
    limitations: 'Snapshot operacional de atenção prioritária.',
  },
  period_objections: {
    key: 'period_objections',
    label: 'Objeções no Período',
    definition: 'Total de ocorrências de objeções registradas no ledger de eventos dentro do intervalo selecionado.',
    sourceTable: 'conversation_objection_occurrences',
    timeField: 'occurred_at',
    denominator: 'Total de ocorrências no período anterior',
    roleScope: 'owner_admin',
    limitations: 'Conta ocorrências temporais de eventos de objeção, não o estado atual estático do contato.',
  },
  top_objections: {
    key: 'top_objections',
    label: 'Top Objeções por Taxonomia',
    definition: 'Agrupamento de ocorrências de objeções por código e categoria canônica com contagem, percentual e variação.',
    sourceTable: 'conversation_objection_occurrences + tenant_objection_taxonomy',
    timeField: 'occurred_at',
    denominator: 'Total geral de ocorrências no período selecionado',
    roleScope: 'owner_admin',
    limitations: 'Baseado no ledger de ocorrências estruturadas extraídas ou anotadas.',
  },
  product_demand: {
    key: 'product_demand',
    label: 'Demanda por Produto',
    definition: 'Contatos únicos interessados e total de menções de interesse por item de catálogo no período.',
    sourceTable: 'conversation_insights (type = interest) + catalog_items',
    timeField: 'observed_at',
    denominator: null,
    roleScope: 'owner_admin',
    limitations: 'Registra menções comerciais observadas no atendimento.',
  },
  product_friction: {
    key: 'product_friction',
    label: 'Fricção por Produto',
    definition: 'Proporção de contatos com objeção em relação aos contatos interessados para um produto específico (Objeções / Interessados * 100).',
    sourceTable: 'conversation_objection_occurrences + conversation_insights',
    timeField: 'occurred_at / observed_at',
    denominator: 'Contatos únicos com interesse no produto no período',
    roleScope: 'owner_admin',
    limitations: 'Se o produto não tiver interessados registrados no período, a fricção é 0% ou indeterminada.',
  },
  seller_median_response: {
    key: 'seller_median_response',
    label: 'Tempo Mediano de Primeira Resposta',
    definition: 'Mediana (percentil 50) da duração em segundos entre a primeira mensagem do cliente e a primeira resposta do agente no período.',
    sourceTable: 'conversations',
    timeField: 'first_response_at',
    denominator: 'Episódios de resposta no período',
    roleScope: 'owner_admin',
    limitations: 'Apenas conversas com resposta de agente registrada.',
  },
  seller_p90_response: {
    key: 'seller_p90_response',
    label: 'P90 de Resposta',
    definition: 'Percentil 90 da duração em segundos da primeira resposta no período.',
    sourceTable: 'conversations',
    timeField: 'first_response_at',
    denominator: 'Episódios de resposta no período',
    roleScope: 'owner_admin',
    limitations: 'Identifica cauda longa de lentidão no atendimento.',
  },
  seller_followups_on_time: {
    key: 'seller_followups_on_time',
    label: 'Taxa de Follow-ups no Prazo',
    definition: 'Percentual de tarefas concluídas pelo vendedor onde completed_at <= due_at.',
    sourceTable: 'tasks',
    timeField: 'completed_at',
    denominator: 'Total de follow-ups concluídos pelo vendedor no período',
    roleScope: 'owner_admin',
    limitations: 'Requer que a tarefa tenha sido marcada como concluída.',
  },
  pipeline_snapshot: {
    key: 'pipeline_snapshot',
    label: 'Pipeline Atual',
    definition: 'Contagem e soma de valor de negócios abertos (status = open) agrupados por estágio.',
    sourceTable: 'deals + pipeline_stages',
    timeField: null,
    denominator: null,
    roleScope: 'owner_admin',
    limitations: 'Snapshot do estado atual. Não deve ser interpretado como resultado histórico acumulado sem histórico de transições.',
  },
};
