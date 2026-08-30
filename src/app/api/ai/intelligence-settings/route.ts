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
import { encrypt } from '@/lib/whatsapp/encryption';

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
      .select('api_key')
      .eq('account_id', accountId)
      .maybeSingle();

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

    // 1. If an apiKey is provided, store it encrypted in ai_configs
    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      const encrypted = encrypt(apiKey.trim());
      await supabase
        .from('ai_configs')
        .upsert(
          {
            account_id: accountId,
            api_key: encrypted,
            provider: settings?.provider || 'openai',
            model: settings?.model || 'gpt-4o-mini',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'account_id' }
        );
    }

    // 2. Save Tenant Intelligence Settings
    let updatedSettings = null;
    if (settings) {
      updatedSettings = await saveTenantIntelligenceSettings(
        supabase,
        accountId,
        {
          enabled: !!settings.enabled,
          invocation_mode: settings.invocation_mode || 'on_demand',
          provider: settings.provider || 'openai',
          model: settings.model || 'gpt-4o-mini',
          extractor_version: settings.extractor_version || 'v1',
          prompt_version: settings.prompt_version || 'v1',
          temperature: typeof settings.temperature === 'number' ? settings.temperature : 0.1,
          timeout_ms: typeof settings.timeout_ms === 'number' ? settings.timeout_ms : 25000,
          max_ai_actions_per_day: settings.max_ai_actions_per_day,
          max_ai_actions_per_month: settings.max_ai_actions_per_month,
          monthly_budget_limit_usd: settings.monthly_budget_limit_usd,
        }
      );
    }

    // 3. Save Lead Scoring Rules (if provided)
    let updatedScoring = null;
    if (scoringConfig && scoringRules) {
      updatedScoring = await saveLeadScoringConfiguration(
        supabase,
        accountId,
        scoringConfig,
        scoringRules
      );
    }

    return NextResponse.json({
      settings: updatedSettings,
      scoring: updatedScoring,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
