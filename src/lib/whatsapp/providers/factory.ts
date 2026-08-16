import { decrypt } from '@/lib/whatsapp/encryption'
import type { WhatsAppProvider, WhatsAppProviderType } from './types'
import { MetaCloudProvider } from './meta/provider'
import { WahaProvider } from './waha/provider'

export interface WhatsAppAccountConfig {
  provider?: WhatsAppProviderType | string | null
  phone_number_id?: string | null
  access_token?: string | null
  waba_id?: string | null
  waha_base_url?: string | null
  waha_session_name?: string | null
  decrypted_access_token?: string | null
}

/**
 * Pure factory: resolves and instantiates the correct WhatsAppProvider
 * instance from an account configuration object.
 *
 * Does NOT perform direct DB lookups, keeping construction cleanly
 * decoupled from persistence and business logic.
 */
export function getWhatsAppProvider(config: WhatsAppAccountConfig): WhatsAppProvider {
  const providerType: WhatsAppProviderType =
    config.provider === 'waha' ? 'waha' : 'meta'

  const rawToken =
    config.decrypted_access_token ||
    (config.access_token ? safeDecrypt(config.access_token) : '')

  if (providerType === 'waha') {
    const baseUrl =
      config.waha_base_url ||
      process.env.WAHA_BASE_URL ||
      'http://localhost:3001'

    const session = config.waha_session_name || 'wacrm'
    const apiKey = rawToken || process.env.WAHA_API_KEY || ''

    return new WahaProvider({
      baseUrl,
      apiKey,
      session,
    })
  }

  // Default: Meta Cloud Provider
  const phoneNumberId = config.phone_number_id || ''
  const accessToken = rawToken || ''
  const wabaId = config.waba_id || null

  return new MetaCloudProvider({
    phoneNumberId,
    accessToken,
    wabaId,
  })
}

function safeDecrypt(token: string): string {
  try {
    return decrypt(token)
  } catch {
    // If token wasn't encrypted or decryption failed, return raw
    return token
  }
}
