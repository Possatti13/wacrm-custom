import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateUuid } from '../leads/validation'

export class ProviderCredentialMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderCredentialMismatchError'
  }
}

export class MissingAiCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingAiCredentialError'
  }
}

export interface IntelligenceCredentialResult {
  apiKey: string
  provider: string
}

/**
 * Loads and decrypts only the raw API credential for the requested provider.
 *
 * Requirements:
 * - Governed solely by tenant_intelligence_settings (ignores ai_configs.is_active).
 * - Strips all auto-reply personas, prompts, and behavioral configs.
 * - Validates provider compatibility between tenant settings and stored credentials.
 */
export async function loadIntelligenceCredential(
  db: SupabaseClient,
  accountId: string,
  expectedProvider: 'openai' | 'anthropic' | 'xai' | 'mock' | 'gemini'
): Promise<IntelligenceCredentialResult> {
  if (expectedProvider === 'mock') {
    return { apiKey: 'mock-key', provider: 'mock' }
  }

  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('ai_configs')
    .select('provider, api_key')
    .eq('account_id', validAccId)
    .maybeSingle()

  if (error) {
    throw new Error(`loadIntelligenceCredential query failed: ${error.message}`)
  }

  if (!data || !data.api_key) {
    throw new MissingAiCredentialError(
      `No AI credential configured for account ${validAccId}`
    )
  }

  if (data.provider !== expectedProvider) {
    throw new ProviderCredentialMismatchError(
      `Tenant intelligence is configured for provider "${expectedProvider}", but configured account credentials are for "${data.provider}"`
    )
  }

  const decryptedKey = decrypt(data.api_key)
  return {
    apiKey: decryptedKey,
    provider: data.provider,
  }
}
