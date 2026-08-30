import crypto from 'crypto';
import type {
  AllowlistedToolName,
  Fact,
  ProviderFactPacket,
  PrivateEntityMap,
  PrivateSellerMap,
  ResolvedPeriod,
} from './types';
import type {
  ManagerCockpitSummary,
  AttentionQueueResponse,
  AttentionQueueItem,
  ObjectionAnalyticsResponse,
  TopObjectionItem,
  ProductIntelligenceResponse,
  ProductIntelligenceItem,
  TeamPerformanceResponse,
  TeamMemberPerformance,
  SignalsAndPipelineResponse,
  CoachingSummaryResponse,
  CoachingOpportunitiesResponse,
  CoachingPatternsResponse,
} from '../types';

export interface BuildFactPacketResult {
  providerFactPacket: ProviderFactPacket;
  privateEntityMap: PrivateEntityMap;
  privateSellerMap: PrivateSellerMap;
}

export function buildFactPacket(params: {
  question: string;
  period: ResolvedPeriod;
  timezone?: string;
  toolOutputs: Partial<Record<AllowlistedToolName, unknown>>;
}): BuildFactPacketResult {
  const { question, period, timezone = 'America/Sao_Paulo', toolOutputs } = params;
  const facts: Fact[] = [];
  const privateEntityMap: PrivateEntityMap = {};
  const privateSellerMap: PrivateSellerMap = {};
  let factIndex = 1;
  let leadIndex = 1;
  let sellerIndex = 1;

  const getOrAssignSellerToken = (userId: string | null, fullName: string, role: string = 'seller'): string => {
    if (!userId) return 'SELLER_UNASSIGNED';
    for (const [token, ent] of Object.entries(privateSellerMap)) {
      if (ent.user_id === userId) return token;
    }
    const token = `SELLER_${sellerIndex++}`;
    privateSellerMap[token] = {
      seller_token: token,
      user_id: userId,
      full_name: fullName,
      role,
    };
    return token;
  };

  const nextFactId = (): string => `F${factIndex++}`;

  // 1. Process manager.summary
  if (toolOutputs['manager.summary']) {
    const summary = toolOutputs['manager.summary'] as ManagerCockpitSummary;
    const pulse = summary.executive_pulse;

    if (pulse) {
      facts.push({
        fact_id: nextFactId(),
        metric: 'active_leads',
        label: 'Leads Ativos no Período',
        value: pulse.active_leads?.current ?? 0,
        unit: 'leads',
        period,
        source: 'manager.summary',
        metadata: {
          previous: pulse.active_leads?.previous ?? 0,
          delta_pct: pulse.active_leads?.delta_pct ?? null,
        },
      });

      facts.push({
        fact_id: nextFactId(),
        metric: 'hot_leads',
        label: 'Leads Quentes (Score >= 70)',
        value: pulse.hot_leads?.current ?? 0,
        unit: 'leads',
        period,
        source: 'manager.summary',
        metadata: {
          warm: pulse.hot_leads?.warm ?? 0,
          cold: pulse.hot_leads?.cold ?? 0,
        },
        drilldown_ref: { type: 'attention' },
      });

      facts.push({
        fact_id: nextFactId(),
        metric: 'overdue_followups',
        label: 'Follow-ups Atrasados (Snapshot Atual)',
        value: pulse.overdue_followups?.current ?? 0,
        unit: 'tasks',
        source: 'manager.summary',
        metadata: { is_snapshot: true },
        drilldown_ref: { type: 'attention' },
      });

      facts.push({
        fact_id: nextFactId(),
        metric: 'leads_without_next_action',
        label: 'Leads Sem Próxima Ação',
        value: pulse.leads_without_next_action?.current ?? 0,
        unit: 'leads',
        source: 'manager.summary',
        drilldown_ref: { type: 'attention' },
      });

      facts.push({
        fact_id: nextFactId(),
        metric: 'period_objections',
        label: 'Total de Objeções Registradas',
        value: pulse.period_objections?.current ?? 0,
        unit: 'occurrences',
        period,
        source: 'manager.summary',
        metadata: {
          previous: pulse.period_objections?.previous ?? 0,
          delta_pct: pulse.period_objections?.delta_pct ?? null,
        },
        drilldown_ref: { type: 'objections' },
      });
    }
  }

  // 2. Process manager.objections
  if (toolOutputs['manager.objections']) {
    const objRes = toolOutputs['manager.objections'] as ObjectionAnalyticsResponse;
    const totalCount = objRes.total_count ?? 0;

    facts.push({
      fact_id: nextFactId(),
      metric: 'total_objections_count',
      label: 'Volume Total de Objeções no Período',
      value: totalCount,
      unit: 'occurrences',
      period,
      source: 'manager.objections',
      metadata: {
        previous_total: objRes.previous_total_count ?? 0,
        delta_pct: objRes.delta_pct ?? null,
      },
      drilldown_ref: { type: 'objections' },
    });

    for (const obj of (objRes.top_objections || []) as TopObjectionItem[]) {
      const sharePct = totalCount > 0 ? Number(((obj.count / totalCount) * 100).toFixed(1)) : 0;
      facts.push({
        fact_id: nextFactId(),
        metric: 'objection_breakdown',
        label: `Objeção: ${obj.name} (${obj.code})`,
        value: obj.count,
        unit: 'occurrences',
        period,
        source: 'manager.objections',
        numerator: obj.count,
        denominator: totalCount,
        metadata: {
          taxonomy_id: obj.taxonomy_id,
          category_code: obj.code,
          category_name: obj.name,
          share_pct: sharePct,
          percentage: obj.percentage,
          previous_count: obj.previous_count ?? 0,
          delta_pct: obj.delta_pct ?? null,
          sample_quote: obj.sample_quote ?? null,
        },
        drilldown_ref: {
          type: 'objections',
          taxonomy_id: obj.taxonomy_id,
          taxonomy_code: obj.code,
          title: obj.name,
        },
      });
    }
  }

  // 3. Process manager.products
  if (toolOutputs['manager.products']) {
    const prodRes = toolOutputs['manager.products'] as ProductIntelligenceResponse;

    for (const prod of (prodRes.products || []) as ProductIntelligenceItem[]) {
      facts.push({
        fact_id: nextFactId(),
        metric: 'product_demand_and_friction',
        label: `Produto: ${prod.name}`,
        value: prod.unique_interested_contacts,
        unit: 'interested_contacts',
        period,
        source: 'manager.products',
        metadata: {
          product_id: prod.catalog_item_id,
          sku: prod.sku,
          interest_occurrences: prod.interest_occurrences,
          friction_rate_pct: prod.friction_rate,
          objection_occurrences: prod.objection_occurrences,
          top_objection_name: prod.top_objection_name,
          top_objection_code: prod.top_objection_code,
          top_objection_count: prod.top_objection_count,
        },
        drilldown_ref: {
          type: 'products',
          product_id: prod.catalog_item_id,
          title: prod.name,
        },
      });
    }
  }

  // 4. Process manager.team
  if (toolOutputs['manager.team']) {
    const teamRes = toolOutputs['manager.team'] as TeamPerformanceResponse;

    for (const member of (teamRes.team || []) as TeamMemberPerformance[]) {
      facts.push({
        fact_id: nextFactId(),
        metric: 'seller_performance',
        label: `Vendedor: ${member.full_name}`,
        value: member.conversations_handled,
        unit: 'conversations_handled',
        period,
        source: 'manager.team',
        metadata: {
          user_id: member.user_id,
          role: member.role,
          median_response_seconds: member.median_response_seconds,
          p90_response_seconds: member.p90_response_seconds,
          followups_completed: member.followups_completed,
          followups_on_time: member.followups_on_time,
          followups_overdue: member.followups_overdue,
          followups_on_time_pct: member.followups_on_time_pct,
          hot_leads_without_action: member.hot_leads_without_action,
          objections_encountered: member.objections_encountered,
        },
        drilldown_ref: {
          type: 'team',
          seller_id: member.user_id,
          title: member.full_name,
        },
      });
    }
  }

  // 5. Process manager.attention (with PII minimization: LEAD_1, LEAD_2)
  if (toolOutputs['manager.attention']) {
    const attRes = toolOutputs['manager.attention'] as AttentionQueueResponse;
    let leadIndex = 1;

    for (const item of ((attRes.items || []) as AttentionQueueItem[]).slice(0, 15)) {
      const leadToken = `LEAD_${leadIndex++}`;
      
      // Store in server-side private entity map ONLY
      privateEntityMap[leadToken] = {
        lead_token: leadToken,
        contact_id: item.contact_id,
        contact_name: item.contact_name,
        phone: item.contact_phone ?? undefined,
        score: item.score,
        reasons: item.reason_code ? [item.reason_label] : [],
      };

      // Provider fact contains ZERO personal data (only opaque token and commercial score)
      facts.push({
        fact_id: nextFactId(),
        metric: 'attention_lead',
        label: `Oportunidade Prioritária: ${leadToken}`,
        value: item.score ?? 0,
        unit: 'lead_score',
        source: 'manager.attention',
        metadata: {
          lead_token: leadToken,
          priority: item.priority,
          reason_code: item.reason_code,
          reason_label: item.reason_label,
          score_tier: item.score_tier,
          responsible_user_name: item.responsible_user_name,
          signal_text: item.signal_text,
          idle_time_seconds: item.idle_time_seconds,
          next_action_text: item.next_action_text,
        },
        drilldown_ref: {
          type: 'attention',
          title: `Oportunidade ${leadToken}`,
          filter: { lead_token: leadToken },
        },
      });
    }
  }

  // 6. Process manager.signals_pipeline
  if (toolOutputs['manager.signals_pipeline']) {
    const sigRes = toolOutputs['manager.signals_pipeline'] as SignalsAndPipelineResponse;
    const snapshot = sigRes.pipeline_snapshot;

    if (snapshot) {
      facts.push({
        fact_id: nextFactId(),
        metric: 'pipeline_overview',
        label: 'Visão Geral do Pipeline',
        value: snapshot.total_open_deals ?? 0,
        unit: 'open_deals',
        source: 'manager.signals_pipeline',
        metadata: {
          total_open_value: snapshot.total_open_value ?? 0,
        },
        drilldown_ref: { type: 'deals', title: 'Pipeline Comercial' },
      });

      for (const stage of snapshot.stages || []) {
        facts.push({
          fact_id: nextFactId(),
          metric: 'pipeline_stage',
          label: `Estágio: ${stage.stage_name}`,
          value: stage.deals_count,
          unit: 'deals',
          source: 'manager.signals_pipeline',
          metadata: {
            stage_id: stage.stage_id,
            position: stage.position,
            total_value: stage.total_value,
          },
          drilldown_ref: { type: 'deals', title: stage.stage_name },
        });
      }
    }

    // Buying signals
    for (const sig of (sigRes.buying_signals || []).slice(0, 5)) {
      facts.push({
        fact_id: nextFactId(),
        metric: 'buying_signal',
        label: `Sinal de Compra: Score ${sig.score}`,
        value: sig.score,
        unit: 'lead_score',
        source: 'manager.signals_pipeline',
        metadata: {
          signal_text: sig.signal_text,
          score_tier: sig.score_tier,
          has_followup: sig.has_followup,
        },
      });
    }
  }

  // 7. Process manager.coaching_summary
  if (toolOutputs['manager.coaching_summary']) {
    const coachSum = toolOutputs['manager.coaching_summary'] as CoachingSummaryResponse;
    facts.push({
      fact_id: nextFactId(),
      metric: 'coaching_open_opportunities',
      label: 'Oportunidades de Coaching em Aberto',
      value: coachSum.total_open_opportunities,
      unit: 'opportunities',
      period,
      source: 'manager.coaching_summary',
      metadata: {
        urgent_count: coachSum.urgent_count,
        high_count: coachSum.high_count,
        reviewed_count: coachSum.reviewed_count,
      },
    });

    if (coachSum.category_breakdown) {
      facts.push({
        fact_id: nextFactId(),
        metric: 'coaching_buying_signals_missed',
        label: 'Sinais de Compra Sem Retorno',
        value: coachSum.category_breakdown.buying_signals_missed,
        unit: 'opportunities',
        period,
        source: 'manager.coaching_summary',
      });
      facts.push({
        fact_id: nextFactId(),
        metric: 'coaching_overdue_followups',
        label: 'Follow-ups com Prazo Vencido',
        value: coachSum.category_breakdown.overdue_followups,
        unit: 'opportunities',
        period,
        source: 'manager.coaching_summary',
      });
      facts.push({
        fact_id: nextFactId(),
        metric: 'coaching_unanswered_customer',
        label: 'Clientes Aguardando Resposta',
        value: coachSum.category_breakdown.unanswered_customer,
        unit: 'opportunities',
        period,
        source: 'manager.coaching_summary',
      });
    }
  }

  // 8. Process manager.coaching_opportunities
  if (toolOutputs['manager.coaching_opportunities']) {
    const oppRes = toolOutputs['manager.coaching_opportunities'] as CoachingOpportunitiesResponse;
    for (const opp of (oppRes.items || []).slice(0, 10)) {
      const leadToken = `LEAD_${leadIndex++}`;
      const sellerToken = getOrAssignSellerToken(opp.responsible_user_id, opp.responsible_user_name);

      privateEntityMap[leadToken] = {
        lead_token: leadToken,
        contact_id: opp.contact_id,
        contact_name: opp.contact_name,
        phone: opp.contact_phone ?? undefined,
        score: opp.lead_score,
        reasons: [opp.primary_reason, ...(opp.secondary_signals || [])],
      };

      facts.push({
        fact_id: nextFactId(),
        metric: 'coaching_opportunity',
        label: `Oportunidade de Revisão: ${opp.category} (${leadToken})`,
        value: opp.lead_score ?? 0,
        unit: 'lead_score',
        period,
        source: 'manager.coaching_opportunities',
        metadata: {
          lead_token: leadToken,
          seller_token: sellerToken,
          category: opp.category,
          severity: opp.severity,
          primary_reason: opp.primary_reason,
          secondary_signals: opp.secondary_signals,
          status: opp.status,
        },
        drilldown_ref: {
          type: 'coaching',
          title: `Revisão ${leadToken}`,
          filter: {
            opportunity_key: opp.opportunity_key,
            lead_token: leadToken,
          },
        },
      });
    }
  }

  // 9. Process manager.coaching_patterns
  if (toolOutputs['manager.coaching_patterns']) {
    const patRes = toolOutputs['manager.coaching_patterns'] as CoachingPatternsResponse;
    for (const objPat of (patRes.objection_patterns || []).slice(0, 5)) {
      const sellerToken = getOrAssignSellerToken(objPat.seller_id, objPat.seller_name);
      facts.push({
        fact_id: nextFactId(),
        metric: 'coaching_seller_objection_pattern',
        label: `Padrão de Objeção: ${objPat.objection_name} (${sellerToken})`,
        value: objPat.occurrences,
        unit: 'occurrences',
        period,
        source: 'manager.coaching_patterns',
        metadata: {
          seller_token: sellerToken,
          objection_code: objPat.objection_code,
          objection_name: objPat.objection_name,
          occurrences: objPat.occurrences,
        },
      });
    }

    for (const folPat of (patRes.followup_patterns || []).slice(0, 5)) {
      const sellerToken = getOrAssignSellerToken(folPat.seller_id, folPat.seller_name);
      facts.push({
        fact_id: nextFactId(),
        metric: 'coaching_seller_followup_friction',
        label: `Atraso em Follow-up (${sellerToken})`,
        value: folPat.overdue_pct,
        unit: 'percent',
        numerator: folPat.overdue_tasks,
        denominator: folPat.total_tasks,
        period,
        source: 'manager.coaching_patterns',
        metadata: {
          seller_token: sellerToken,
          overdue_tasks: folPat.overdue_tasks,
          total_tasks: folPat.total_tasks,
        },
      });
    }
  }

  const normalizedQuestion = normalizeQuestionForCache(question);

  return {
    providerFactPacket: {
      question_context: {
        original_question: question,
        normalized_question: normalizedQuestion,
        period: {
          range: period.range,
          start: period.start || null,
          end: period.end || null,
          label: period.label || undefined,
        },
        timezone,
      },
      facts,
    },
    privateEntityMap,
    privateSellerMap,
  };
}

export function normalizeQuestionForCache(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents for cache invariance
    .replace(/[^\w\s]/gi, ' ') // replace punctuation with spaces
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeFactPacketFingerprint(packet: ProviderFactPacket): string {
  const canonicalFacts = packet.facts.map((f) => ({
    i: f.fact_id,
    m: f.metric,
    l: f.label,
    v: f.value,
    u: f.unit || null,
    s: f.source,
    num: f.numerator || null,
    den: f.denominator || null,
    meta: f.metadata || null,
  }));

  // Canonical payload strictly omitting volatile timestamps
  const canonicalPayload = JSON.stringify({
    q: packet.question_context.normalized_question,
    p: {
      range: packet.question_context.period.range,
      start: packet.question_context.period.start || null,
      end: packet.question_context.period.end || null,
    },
    f: canonicalFacts,
  });

  return crypto.createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}
