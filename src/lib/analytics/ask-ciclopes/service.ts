import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { getTenantIntelligenceSettings } from '@/lib/intelligence/settings';
import { loadIntelligenceCredential } from '@/lib/intelligence/credentials';
import { MockStructuredExtractor } from '@/lib/intelligence/providers/mock';
import { OpenAiStructuredExtractor } from '@/lib/intelligence/providers/openai';
import { AnthropicStructuredExtractor } from '@/lib/intelligence/providers/anthropic';
import { XAiStructuredExtractor } from '@/lib/intelligence/providers/xai';
import { GeminiStructuredExtractor } from '@/lib/intelligence/providers/gemini';
import type { CommercialIntelligenceProvider } from '@/lib/intelligence/types';
import { planManagerQuestion } from './planner';
import { executePlannedTools } from './tool-registry';
import { buildFactPacket, computeFactPacketFingerprint } from './fact-packet';
import { synthesizeManagerAnswer } from './synthesis';
import { validateAndSanitizeSynthesis } from './validator';
import type { AskCiclopesRequestParams, AskCiclopesResult, TokenUsage } from './types';
import { estimateTokenCost } from '@/lib/intelligence/on-demand';

export async function askCiclopes(
  db: SupabaseClient,
  params: AskCiclopesRequestParams
): Promise<AskCiclopesResult> {
  const { accountId, userId, userRole, question, threadId: initialThreadId, forceRefresh = false } = params;
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  // 1. Authorization Guard
  if (userRole !== 'owner' && userRole !== 'admin') {
    throw new Error('Unauthorized: Ask Ciclopes is strictly restricted to Owner and Admin managers');
  }

  // 2. Load Settings & Budget Check
  const adminClient = typeof supabaseAdmin === 'function' ? supabaseAdmin() : db;
  const settings = await getTenantIntelligenceSettings(adminClient, accountId);

  const providerName = settings?.provider || 'gemini';
  const model = settings?.model || 'gemini-3.5-flash-lite';

  // Budget Circuit Breaker
  if (settings?.monthly_budget_limit_usd !== null && settings?.monthly_budget_limit_usd !== undefined) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { data: usageRows } = await adminClient
      .from('ai_usage_log')
      .select('estimated_cost')
      .eq('account_id', accountId)
      .gte('created_at', monthStart.toISOString());

    const totalSpent = (usageRows || []).reduce((acc, row) => acc + Number(row.estimated_cost || 0), 0);
    if (totalSpent >= Number(settings.monthly_budget_limit_usd)) {
      const budgetBlockedTurnId = crypto.randomUUID();
      return {
        requestId,
        threadId: initialThreadId || crypto.randomUUID(),
        turnId: budgetBlockedTurnId,
        question,
        answer: 'Inteligência temporariamente indisponível devido ao limite orçamentário configurado para a conta.',
        claims: [],
        recommendations: [],
        drilldowns: [],
        resolvedPeriod: { range: '30d' },
        facts: [],
        opaqueEntities: {},
        cached: false,
        provider: providerName,
        model,
        latencyMs: Date.now() - startTime,
        createdAt: new Date().toISOString(),
      };
    }
  }

  // 3. Resolve Provider
  let provider: CommercialIntelligenceProvider;
  if (providerName === 'mock') {
    provider = new MockStructuredExtractor();
  } else {
    const cred = await loadIntelligenceCredential(adminClient, accountId, providerName);
    switch (providerName) {
      case 'gemini':
        provider = new GeminiStructuredExtractor(cred.apiKey);
        break;
      case 'openai':
        provider = new OpenAiStructuredExtractor(cred.apiKey);
        break;
      case 'anthropic':
        provider = new AnthropicStructuredExtractor(cred.apiKey);
        break;
      case 'xai':
        provider = new XAiStructuredExtractor(cred.apiKey);
        break;
      default:
        provider = new GeminiStructuredExtractor(cred.apiKey);
    }
  }

  // 4. Planner Stage
  const planRes = await planManagerQuestion({
    provider,
    question,
    model,
  });

  const plan = planRes.plan;

  // Log Planner Telemetry
  if (planRes.usage) {
    await logAiUsageLog(adminClient, {
      accountId,
      userId,
      requestId,
      provider: providerName,
      model,
      usage: planRes.usage,
      actionType: 'ask_ciclopes',
    });
  }

  // 5. Handle Clarification or Unsupported questions
  if (plan.clarification_required && plan.clarification_question) {
    const clarificationTurnId = crypto.randomUUID();
    return {
      requestId,
      threadId: initialThreadId || crypto.randomUUID(),
      turnId: clarificationTurnId,
      question,
      answer: plan.clarification_question,
      claims: [],
      recommendations: [],
      drilldowns: [],
      resolvedPeriod: plan.period,
      facts: [],
      opaqueEntities: {},
      cached: false,
      provider: providerName,
      model,
      plannerTokens: planRes.usage,
      latencyMs: Date.now() - startTime,
      createdAt: new Date().toISOString(),
    };
  }

  if (plan.intent === 'unsupported') {
    const unsupportedTurnId = crypto.randomUUID();
    const unsupportedAnswer =
      plan.unsupported_reason ||
      'Não é possível realizar previsões subjetivas ou alterações operacionais pelo Ask Ciclopes. No entanto, você pode consultar métricas reais, leads prioritários, objeções ou o desempenho atual da sua equipe.';
    return {
      requestId,
      threadId: initialThreadId || crypto.randomUUID(),
      turnId: unsupportedTurnId,
      question,
      answer: unsupportedAnswer,
      claims: [],
      recommendations: [],
      drilldowns: [],
      resolvedPeriod: plan.period,
      facts: [],
      opaqueEntities: {},
      cached: false,
      provider: providerName,
      model,
      plannerTokens: planRes.usage,
      latencyMs: Date.now() - startTime,
      createdAt: new Date().toISOString(),
    };
  }

  // 6. Tool Execution Stage (Strictly Server-Side Authorized RPCs)
  const toolOutputs = await executePlannedTools(
    adminClient,
    accountId,
    userRole,
    plan.tool_calls,
    plan.period
  );

  // 7. Fact Packet Construction & Fingerprinting
  const factPacket = buildFactPacket({
    question,
    period: plan.period,
    toolOutputs,
  });

  const factPacketHash = computeFactPacketFingerprint(factPacket);

  // 8. Cache Lookup
  if (!forceRefresh) {
    const { data: cachedTurn } = await adminClient
      .from('manager_ai_turns')
      .select('*')
      .eq('account_id', accountId)
      .eq('fact_packet_hash', factPacketHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cachedTurn) {
      return {
        requestId,
        threadId: initialThreadId || cachedTurn.thread_id,
        turnId: cachedTurn.id,
        question,
        answer: cachedTurn.answer,
        claims: cachedTurn.claims || [],
        recommendations: cachedTurn.recommendations || [],
        drilldowns: cachedTurn.drilldowns || [],
        resolvedPeriod: cachedTurn.resolved_period || plan.period,
        facts: factPacket.facts,
        opaqueEntities: factPacket.opaque_entities,
        cached: true,
        provider: cachedTurn.provider,
        model: cachedTurn.model,
        plannerTokens: planRes.usage,
        synthesisTokens: cachedTurn.synthesis_tokens,
        latencyMs: Date.now() - startTime,
        createdAt: cachedTurn.created_at,
      };
    }
  }

  // 9. Answer Synthesis Stage
  const synthRes = await synthesizeManagerAnswer({
    provider,
    question,
    factPacket,
    model,
  });

  // Log Synthesis Telemetry
  if (synthRes.usage) {
    await logAiUsageLog(adminClient, {
      accountId,
      userId,
      requestId,
      provider: providerName,
      model,
      usage: synthRes.usage,
      actionType: 'ask_ciclopes',
    });
  }

  // 10. Claim Grounding & Numeric Safety Validation
  const validated = validateAndSanitizeSynthesis(synthRes.synthesis, factPacket);

  // 11. Thread & Turn Persistence
  let threadId = initialThreadId;
  if (!threadId) {
    const { data: threadRow } = await adminClient
      .from('manager_ai_threads')
      .insert({
        account_id: accountId,
        user_id: userId,
        title: question.slice(0, 60),
      })
      .select('id')
      .single();
    threadId = threadRow?.id || crypto.randomUUID();
  }

  const turnId = crypto.randomUUID();
  await adminClient.from('manager_ai_turns').insert({
    id: turnId,
    thread_id: threadId,
    account_id: accountId,
    user_id: userId,
    question,
    resolved_intent: plan.intent,
    resolved_period: plan.period,
    tool_calls: plan.tool_calls,
    fact_packet: factPacket,
    fact_packet_hash: factPacketHash,
    answer: validated.sanitizedSynthesis.answer,
    claims: validated.sanitizedSynthesis.claims,
    recommendations: validated.sanitizedSynthesis.recommendations,
    drilldowns: validated.sanitizedSynthesis.drilldowns,
    opaque_entities: factPacket.opaque_entities,
    provider: providerName,
    model,
    cached: false,
    planner_tokens: planRes.usage || null,
    synthesis_tokens: synthRes.usage || null,
    latency_ms: Date.now() - startTime,
  });

  return {
    requestId,
    threadId: threadId!,
    turnId,
    question,
    answer: validated.sanitizedSynthesis.answer,
    claims: validated.sanitizedSynthesis.claims,
    recommendations: validated.sanitizedSynthesis.recommendations,
    drilldowns: validated.sanitizedSynthesis.drilldowns,
    resolvedPeriod: plan.period,
    facts: factPacket.facts,
    opaqueEntities: factPacket.opaque_entities,
    cached: false,
    provider: providerName,
    model,
    plannerTokens: planRes.usage,
    synthesisTokens: synthRes.usage,
    latencyMs: Date.now() - startTime,
    createdAt: new Date().toISOString(),
  };
}

async function logAiUsageLog(
  db: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    requestId: string;
    provider: string;
    model: string;
    usage: TokenUsage;
    actionType: string;
  }
) {
  try {
    const cost = estimateTokenCost(params.model, params.usage.promptTokens, params.usage.completionTokens);
    const { error } = await db.from('ai_usage_log').insert({
      account_id: params.accountId,
      requested_by_user_id: params.userId,
      request_id: params.requestId,
      mode: 'internal_on_demand',
      action_type: params.actionType,
      provider: params.provider,
      model: params.model,
      prompt_tokens: params.usage.promptTokens,
      completion_tokens: params.usage.completionTokens,
      total_tokens: params.usage.totalTokens,
      estimated_cost: cost,
      cached: false,
    });
    if (error) {
      console.error('[ask-ciclopes] logAiUsageLog insert error:', error);
    }
  } catch (err) {
    console.error('[ask-ciclopes] Failed to log AI usage:', err);
  }
}
