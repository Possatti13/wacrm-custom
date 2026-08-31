import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  getTenantIntelligenceSettings,
  saveTenantIntelligenceSettings,
  getTenantAiCostStats,
} from '@/lib/intelligence/settings';
import {
  getLeadScoringConfig,
  saveLeadScoringConfiguration,
} from '@/lib/scoring/repository';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { discoverGeminiModels, GEMINI_FALLBACK_MODELS } from '@/lib/ai/providers/gemini-models';
import type { LeadScoringRule } from '@/lib/scoring/types';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const [intelSettings, scoringConfig, costStats] = await Promise.all([
      getTenantIntelligenceSettings(supabase, accountId),
      getLeadScoringConfig(supabase, accountId).catch(() => null),
      getTenantAiCostStats(supabase, accountId).catch(() => null),
    ]);

    // Check if ai_configs has an API key stored (never return the plaintext key)
    const { data: aiConfig } = await supabase
      .from('ai_configs')
      .select('api_key, provider')
      .eq('account_id', accountId)
      .maybeSingle();

    let geminiModels = GEMINI_FALLBACK_MODELS;
    if (aiConfig?.api_key && aiConfig.provider === 'gemini') {
      try {
        const decryptedKey = decrypt(aiConfig.api_key);
        geminiModels = await discoverGeminiModels(decryptedKey);
      } catch {
        geminiModels = GEMINI_FALLBACK_MODELS;
      }
    }

    return NextResponse.json({
      settings: intelSettings || {
        account_id: accountId,
        enabled: false,
        invocation_mode: 'on_demand',
        provider: 'openai',
        model: 'gpt-4o-mini',
        extractor_version: 'v1',
        prompt_version: 'v1',
        temperature: 0.1,
        timeout_ms: 25000,
        max_ai_actions_per_day: 1000,
        max_ai_actions_per_month: 25000,
        monthly_budget_limit_usd: null,
      },
      has_api_key: !!aiConfig?.api_key,
      scoring: scoringConfig,
      cost_stats: costStats,
      gemini_models: geminiModels,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await req.json();

    const {
      settings,
      apiKey,
      scoringConfig,
      scoringRules,
    } = body;

    // 1. Process API Key: If a new non-empty plaintext key is provided (and not the masked placeholder), encrypt it
    let encryptedApiKey: string | null = null;
    if (
      typeof apiKey === 'string' &&
      apiKey.trim().length > 0 &&
      !apiKey.includes('••••')
    ) {
      encryptedApiKey = encrypt(apiKey.trim());
    }

    // 2. Atomic Save: Updates both tenant_intelligence_settings and ai_configs in a single DB transaction
    const updatedSettings = await saveTenantIntelligenceSettings(
      supabase,
      accountId,
      {
        enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : false,
        invocation_mode: settings?.invocation_mode || 'smart_auto',
        provider: settings?.provider || 'gemini',
        model: settings?.model || 'gemini-3.5-flash-lite',
        extractor_version: settings?.extractor_version || 'v1',
        prompt_version: settings?.prompt_version || 'v1',
        temperature: typeof settings?.temperature === 'number' ? settings.temperature : 0.1,
        timeout_ms: typeof settings?.timeout_ms === 'number' ? settings.timeout_ms : 25000,
        max_ai_actions_per_day: settings?.max_ai_actions_per_day,
        max_ai_actions_per_month: settings?.max_ai_actions_per_month,
        monthly_budget_limit_usd: settings?.monthly_budget_limit_usd,
        encrypted_api_key: encryptedApiKey,
      }
    );

    // 3. Save Lead Scoring Configuration (if provided)
    let updatedScoring = null;
    if (scoringConfig && Array.isArray(scoringRules) && scoringRules.length > 0) {
      const normalizedRules: Partial<LeadScoringRule>[] = scoringRules.map((r: Record<string, unknown>) => {
        const rawKey = String(r.rule_key || r.rule_name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const ruleKey = rawKey.length >= 2 ? rawKey : `rule_${rawKey}`;
        const points = typeof r.points === 'number' ? r.points : (typeof r.weight === 'number' ? r.weight : 0);
        const label = String(r.label || r.rule_name || ruleKey);
        const signalType = (r.signal_type as LeadScoringRule['signal_type']) || (
          r.rule_type === 'intent' || r.rule_type === 'urgency' || ruleKey.includes('intent') || ruleKey.includes('urgency')
            ? 'profile_field'
            : r.rule_type === 'catalog' || ruleKey.includes('catalog')
              ? 'catalog_interest'
              : r.rule_type === 'objection' || ruleKey.includes('objection')
                ? 'objection_presence'
                : 'attribute'
        );
        const operator = (r.operator as LeadScoringRule['operator']) || (signalType === 'catalog_interest' || signalType === 'objection_presence' ? 'exists' : 'equals');
        const fieldKey = r.field_key !== undefined
          ? (r.field_key as string | null)
          : (ruleKey.includes('intent') ? 'current_intent' : ruleKey.includes('urgency') ? 'urgency' : null);
        const expectedValue = r.expected_value !== undefined
          ? (r.expected_value as string | number | boolean | null)
          : (ruleKey.includes('intent') ? 'purchase' : ruleKey.includes('urgency') ? 'high' : null);

        return {
          rule_key: ruleKey,
          label,
          signal_type: signalType,
          field_key: fieldKey,
          operator,
          expected_value: expectedValue,
          points,
          status: (r.status as LeadScoringRule['status']) || 'active',
        };
      });

      updatedScoring = await saveLeadScoringConfiguration(
        supabase,
        accountId,
        scoringConfig,
        normalizedRules
      );
    }

    return NextResponse.json({
      ok: true,
      settings: updatedSettings,
      scoring: updatedScoring,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
