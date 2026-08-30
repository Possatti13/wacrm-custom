import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadManagerCockpitSummary,
  loadManagerAttentionQueue,
  loadManagerObjectionAnalytics,
  loadManagerObjectionDrilldown,
  loadManagerProductIntelligence,
  loadManagerTeamPerformance,
  loadManagerSignalsAndPipeline,
} from '../manager-cockpit-repository';
import {
  getManagerCoachingSummary,
  getManagerCoachingOpportunities,
  getManagerCoachingPatterns,
} from '../coaching';
import type { AllowlistedToolName, PlannedToolCall, ResolvedPeriod } from './types';
import type { PeriodRange, CoachingCategory, CoachingReviewStatus } from '../types';

export interface ToolDefinition {
  name: AllowlistedToolName;
  description: string;
  allowedRoles: ('owner' | 'admin')[];
  execute: (
    db: SupabaseClient,
    accountId: string,
    args: Record<string, unknown>,
    period: ResolvedPeriod
  ) => Promise<unknown>;
}

export const TOOL_REGISTRY: Record<AllowlistedToolName, ToolDefinition> = {
  'manager.summary': {
    name: 'manager.summary',
    description: 'Resumo executivo do cockpit com principais KPIs operacionais e comerciais.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return loadManagerCockpitSummary(db, accountId, range, startDate, endDate);
    },
  },

  'manager.attention': {
    name: 'manager.attention',
    description: 'Fila de oportunidades e leads que exigem atenção imediata ou estão em risco.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args) => {
      const priority = (args.priority_filter as 'all' | 'urgent' | 'high' | 'medium') || 'all';
      const limit = Math.min(Number(args.limit) || 20, 50);
      const offset = Number(args.offset) || 0;
      return loadManagerAttentionQueue(db, accountId, priority, limit, offset);
    },
  },

  'manager.objections': {
    name: 'manager.objections',
    description: 'Análise de objeções enfrentadas nas conversas com ranking, percentual e variação.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return loadManagerObjectionAnalytics(db, accountId, range, startDate, endDate);
    },
  },

  'manager.objection_drilldown': {
    name: 'manager.objection_drilldown',
    description: 'Detalhamento de evidências e conversas relacionadas a uma taxonomia de objeção específica.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return loadManagerObjectionDrilldown(db, accountId, {
        taxonomyId: args.taxonomy_id as string | undefined,
        taxonomyCode: args.taxonomy_code as string | undefined,
        range,
        startDate,
        endDate,
        limit: Math.min(Number(args.limit) || 20, 50),
        offset: Number(args.offset) || 0,
      });
    },
  },

  'manager.products': {
    name: 'manager.products',
    description: 'Matriz de demanda e fricção por produto ou serviço com taxas de objeção.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return loadManagerProductIntelligence(db, accountId, range, startDate, endDate);
    },
  },

  'manager.team': {
    name: 'manager.team',
    description: 'Desempenho operacional da equipe de vendas (tempo de primeira resposta, follow-ups no prazo, etc.).',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return loadManagerTeamPerformance(db, accountId, range, startDate, endDate);
    },
  },

  'manager.signals_pipeline': {
    name: 'manager.signals_pipeline',
    description: 'Sinais comerciais recentes (compras, perdas) e snapshot do pipeline de negócios.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return loadManagerSignalsAndPipeline(db, accountId, range, startDate, endDate);
    },
  },

  'manager.coaching_summary': {
    name: 'manager.coaching_summary',
    description: 'Resumo executivo de coaching com total de oportunidades de melhoria e áreas de foco prioritárias.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return getManagerCoachingSummary(db, accountId, {
        range,
        customStart: startDate,
        customEnd: endDate,
      });
    },
  },

  'manager.coaching_opportunities': {
    name: 'manager.coaching_opportunities',
    description: 'Oportunidades determinísticas de coaching e conversas que merecem revisão da gestão.',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return getManagerCoachingOpportunities(db, accountId, {
        range,
        customStart: startDate,
        customEnd: endDate,
        sellerId: args.seller_id as string | undefined,
        category: args.category as CoachingCategory | undefined,
        status: (args.status as CoachingReviewStatus | 'all') || 'open',
        limit: Math.min(Number(args.limit) || 20, 50),
        offset: Number(args.offset) || 0,
      });
    },
  },

  'manager.coaching_patterns': {
    name: 'manager.coaching_patterns',
    description: 'Padrões de fricção comercial recorrentes na equipe (objeções repetidas por vendedor, follow-ups atrasados).',
    allowedRoles: ['owner', 'admin'],
    execute: async (db, accountId, args, period) => {
      const range = (args.time_range as PeriodRange) || period.range || '30d';
      const startDate = (args.start_date as string) || period.start || undefined;
      const endDate = (args.end_date as string) || period.end || undefined;
      return getManagerCoachingPatterns(db, accountId, {
        range,
        customStart: startDate,
        customEnd: endDate,
        sellerId: args.seller_id as string | undefined,
      });
    },
  },
};

export async function executePlannedTools(
  db: SupabaseClient,
  accountId: string,
  userRole: 'owner' | 'admin',
  toolCalls: PlannedToolCall[],
  period: ResolvedPeriod
): Promise<Record<AllowlistedToolName, unknown>> {
  const results: Partial<Record<AllowlistedToolName, unknown>> = {};

  // Maximum 4 tool calls per turn to ensure fast execution and atomic safety
  const safeCalls = toolCalls.slice(0, 4);

  for (const call of safeCalls) {
    const tool = TOOL_REGISTRY[call.tool_name];
    if (!tool) {
      throw new Error(`Unauthorized or non-allowlisted tool requested: ${call.tool_name}`);
    }

    if (!tool.allowedRoles.includes(userRole)) {
      throw new Error(`Role ${userRole} is not authorized to execute tool ${call.tool_name}`);
    }

    // Invariant: Account ID is strictly injected server-side
    const toolOutput = await tool.execute(db, accountId, call.args || {}, period);
    results[call.tool_name] = toolOutput;
  }

  return results as Record<AllowlistedToolName, unknown>;
}
