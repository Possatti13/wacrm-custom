/**
 * Ciclopes V1.4.2 — Central Metric Definitions & Contracts
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
    definition: 'Contatos únicos com ao menos uma mensagem comercial real (cliente ou agente) trocada dentro do intervalo do período selecionado.',
    sourceTable: 'messages (sender_type IN (\'customer\', \'agent\')) + conversations',
    timeField: 'created_at',
    denominator: 'Total de contatos únicos com mensagens no período comparativo anterior',
    roleScope: 'owner_admin',
    limitations: 'Calculado estritamente a partir do ledger histórico de mensagens. Ignora alterações cadastrais ou de status administrativo.',
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
    definition: 'Snapshot do momento atual: tarefas de acompanhamento abertas (status = pending) cuja data limite (due_at) é anterior ao momento atual.',
    sourceTable: 'tasks',
    timeField: 'due_at',
    denominator: null,
    roleScope: 'owner_admin',
    limitations: 'Snapshot operacional do momento presente. Sem delta histórico retroativo para evitar falsa precisão causada por tarefas concluídas após o vencimento.',
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
    denominator: 'Total de ocorrências no período comparativo anterior',
    roleScope: 'owner_admin',
    limitations: 'Conta ocorrências temporais de eventos de objeção no ledger histórico.',
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
    definition: 'Percentual de contatos interessados no produto que também apresentaram ao menos uma objeção relacionada ao mesmo produto no período (Interessados com Objeção / Interessados Únicos * 100).',
    sourceTable: 'conversation_insights + conversation_objection_occurrences',
    timeField: 'observed_at / occurred_at',
    denominator: 'Contatos únicos interessados no produto no período selecionado',
    roleScope: 'owner_admin',
    limitations: 'Garante matematicamente 0 <= taxa <= 100%. Numerador é subconjunto estrito do denominador.',
  },
  seller_median_response: {
    key: 'seller_median_response',
    label: 'Tempo Mediano de Primeira Resposta (P50)',
    definition: 'Mediana (percentil 50) da duração em segundos entre o início do primeiro turno de mensagens do cliente (início do burst inicial) e a primeira resposta de um vendedor humano (sender_type = agent com sender_id válido).',
    sourceTable: 'messages',
    timeField: 'messages.created_at',
    denominator: 'Episódios de resposta verificados no período',
    roleScope: 'owner_admin',
    limitations: 'Derivado 100% do ledger de mensagens. Conversas legadas sem mensagem humana comprovada são excluídas para evitar falsa atribuição.',
  },
  seller_p90_response: {
    key: 'seller_p90_response',
    label: 'P90 de Primeira Resposta',
    definition: 'Percentil 90 da duração em segundos da primeira resposta humana verificada no período a partir do ledger de mensagens.',
    sourceTable: 'messages',
    timeField: 'messages.created_at',
    denominator: 'Episódios de resposta verificados no período',
    roleScope: 'owner_admin',
    limitations: 'Atribui a duração estritamente ao sender_id da mensagem real que encerrou a janela de espera inicial do cliente.',
  },
  seller_followups_on_time: {
    key: 'seller_followups_on_time',
    label: 'Taxa de Follow-ups no Prazo',
    definition: 'Percentual de tarefas concluídas pelo vendedor onde completed_at <= due_at no período.',
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
