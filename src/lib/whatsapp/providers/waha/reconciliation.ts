import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  getWahaSession,
  getWahaChats,
  getWahaChatMessages,
  type WahaConfig,
} from '../../waha-api'
import { normalizeWahaInbound } from './normalize-inbound'
import { processNormalizedInboundEvent } from '../../inbound/processor'

export interface ReconcileOptions {
  accountId: string
  db?: SupabaseClient
  overlapMinutes?: number
  initialSyncWindowHours?: number
  forcedChatId?: string
}

export interface ReconcileStats {
  chatsScanned: number
  messagesDiscovered: number
  messagesInserted: number
  duplicatesIgnored: number
  errorsCount: number
  durationMs: number
}

export interface ReconcileResult {
  success: boolean
  reason?: string
  sessionStatus?: string
  stats?: ReconcileStats
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * Reconciles messages from WAHA for a given account.
 * Implements overlap protection window, pagination, idempotency,
 * and records telemetry into whatsapp_sync_state.
 */
export async function reconcileWahaMessages(
  options: ReconcileOptions
): Promise<ReconcileResult> {
  const startTime = Date.now()
  const db = options.db || getAdminClient()
  const accountId = options.accountId
  const overlapMinutes = options.overlapMinutes ?? 10

  // 1. Fetch WAHA configuration for this account
  const { data: configRow, error: configError } = await db
    .from('whatsapp_config')
    .select('provider, access_token, waha_base_url, waha_session_name')
    .eq('account_id', accountId)
    .maybeSingle()

  if (configError || !configRow) {
    return { success: false, reason: 'no_config', error: configError?.message }
  }

  if (configRow.provider !== 'waha') {
    return { success: false, reason: 'provider_not_waha' }
  }

  if (!configRow.access_token || !configRow.waha_base_url || !configRow.waha_session_name) {
    return { success: false, reason: 'incomplete_waha_config' }
  }

  let apiKey: string
  try {
    apiKey = decrypt(configRow.access_token)
  } catch (decErr) {
    return {
      success: false,
      reason: 'decrypt_failed',
      error: decErr instanceof Error ? decErr.message : 'Decrypt failed',
    }
  }

  const wahaConfig: WahaConfig = {
    baseUrl: configRow.waha_base_url,
    apiKey,
    session: configRow.waha_session_name,
  }

  // 2. Check session status — only WORKING sessions can be reconciled
  let sessionStatus = 'UNKNOWN'
  try {
    const session = await getWahaSession(wahaConfig)
    sessionStatus = session.status
    if (session.status !== 'WORKING') {
      return {
        success: false,
        reason: 'session_not_working',
        sessionStatus: session.status,
      }
    }
  } catch (sessErr) {
    return {
      success: false,
      reason: 'waha_unreachable',
      error: sessErr instanceof Error ? sessErr.message : 'WAHA unreachable',
    }
  }

  // 3. Load previous sync boundary from whatsapp_sync_state
  const { data: syncState } = await db
    .from('whatsapp_sync_state')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'waha')
    .maybeSingle()

  let syncFromTimestamp: number

  if (syncState?.last_sync_completed_at) {
    const lastCompleted = new Date(syncState.last_sync_completed_at).getTime()
    // Overlap window (e.g. 10 minutes prior to last completed sync)
    syncFromTimestamp = Math.floor((lastCompleted - overlapMinutes * 60 * 1000) / 1000)
  } else if (typeof options.initialSyncWindowHours === 'number' && options.initialSyncWindowHours > 0) {
    // Initial history sync window (e.g. 24h, 7d, 30d)
    syncFromTimestamp = Math.floor((Date.now() - options.initialSyncWindowHours * 3600 * 1000) / 1000)
  } else {
    // Default initial sync: start from now (with safety 10 min window)
    syncFromTimestamp = Math.floor((Date.now() - overlapMinutes * 60 * 1000) / 1000)
  }

  // 4. Mark sync state as 'syncing'
  await db.from('whatsapp_sync_state').upsert(
    {
      account_id: accountId,
      provider: 'waha',
      session_name: configRow.waha_session_name,
      last_sync_started_at: new Date().toISOString(),
      last_sync_status: 'syncing',
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,provider' }
  )

  const stats: ReconcileStats = {
    chatsScanned: 0,
    messagesDiscovered: 0,
    messagesInserted: 0,
    duplicatesIgnored: 0,
    errorsCount: 0,
    durationMs: 0,
  }

  try {
    // 5. Fetch chats
    const chats = options.forcedChatId
      ? [{ id: options.forcedChatId }]
      : await getWahaChats(wahaConfig, { limit: 100 })

    stats.chatsScanned = chats.length

    // 6. Iterate through each chat and pull messages since boundary
    for (const chat of chats) {
      try {
        const rawMessages = await getWahaChatMessages(wahaConfig, chat.id, {
          limit: 100,
          downloadMedia: false,
        })

        // Sort chronologically ascending so replay preserves true message order
        const filtered = rawMessages
          .filter((m) => typeof m.timestamp === 'number' && m.timestamp >= syncFromTimestamp)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

        for (const rawMsg of filtered) {
          stats.messagesDiscovered++

          const eventPayload = {
            event: 'message',
            session: configRow.waha_session_name,
            payload: {
              ...rawMsg,
              chatId: chat.id,
            },
          }

          const normalized = normalizeWahaInbound(eventPayload, accountId)
          if (!normalized || normalized.type !== 'message') {
            continue
          }

          try {
            const processResult = await processNormalizedInboundEvent({
              event: normalized,
              db,
            })

            if (processResult.duplicate) {
              stats.duplicatesIgnored++
            } else if (processResult.processed) {
              stats.messagesInserted++
            } else {
              stats.errorsCount++
            }
          } catch (itemErr) {
            stats.errorsCount++
            console.error('[waha-reconcile] message ingestion error:', itemErr)
          }
        }
      } catch (chatErr) {
        stats.errorsCount++
        console.warn(`[waha-reconcile] error scanning chat ${chat.id}:`, chatErr)
      }
    }

    stats.durationMs = Date.now() - startTime

    // 7. Update sync state as 'success'
    await db.from('whatsapp_sync_state').upsert(
      {
        account_id: accountId,
        provider: 'waha',
        session_name: configRow.waha_session_name,
        last_sync_completed_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_error: null,
        sync_stats: stats,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider' }
    )

    return {
      success: true,
      sessionStatus,
      stats,
    }
  } catch (err) {
    stats.durationMs = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Reconciliation failed'

    await db.from('whatsapp_sync_state').upsert(
      {
        account_id: accountId,
        provider: 'waha',
        session_name: configRow.waha_session_name,
        last_sync_status: 'error',
        last_sync_error: errorMessage,
        sync_stats: stats,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider' }
    )

    return {
      success: false,
      error: errorMessage,
      sessionStatus,
      stats,
    }
  }
}
