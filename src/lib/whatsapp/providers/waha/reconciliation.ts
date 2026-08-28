import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  getWahaSession,
  getWahaChats,
  getWahaChatMessages,
  resolveWahaLidToPhoneNumber,
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
  chatsSucceeded: number
  chatsFailed: number
  messagesDiscovered: number
  messagesInserted: number
  duplicatesIgnored: number
  errorsCount: number
  durationMs: number
}

export type SyncStatus = 'success' | 'partial' | 'failed' | 'idle' | 'syncing' | 'error'

export interface ReconcileResult {
  success: boolean
  status: SyncStatus
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

// In-memory cooldown per account to avoid concurrent auto-recovery sync storms
const _autoRecoveryLocks = new Map<string, number>()

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
    return { success: false, status: 'failed', reason: 'no_config', error: configError?.message }
  }

  if (configRow.provider !== 'waha') {
    return { success: false, status: 'failed', reason: 'provider_not_waha' }
  }

  if (!configRow.access_token || !configRow.waha_base_url || !configRow.waha_session_name) {
    return { success: false, status: 'failed', reason: 'incomplete_waha_config' }
  }

  let apiKey: string
  try {
    apiKey = decrypt(configRow.access_token)
  } catch (decErr) {
    return {
      success: false,
      status: 'failed',
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
        status: 'failed',
        reason: 'session_not_working',
        sessionStatus: session.status,
      }
    }
  } catch (sessErr) {
    return {
      success: false,
      status: 'failed',
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

  if (syncState?.last_sync_completed_at && syncState?.last_sync_status !== 'failed' && syncState?.last_sync_status !== 'error') {
    const lastCompleted = new Date(syncState.last_sync_completed_at).getTime()
    // Overlap window (e.g. 10 minutes prior to last completed sync)
    syncFromTimestamp = Math.floor((lastCompleted - overlapMinutes * 60 * 1000) / 1000)
  } else if (typeof options.initialSyncWindowHours === 'number' && options.initialSyncWindowHours > 0) {
    // Initial history sync window (e.g. 24h, 7d, 30d)
    syncFromTimestamp = Math.floor((Date.now() - options.initialSyncWindowHours * 3600 * 1000) / 1000)
  } else {
    // Default fallback: 24 hours prior to now to catch any downtime
    syncFromTimestamp = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000)
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
    chatsSucceeded: 0,
    chatsFailed: 0,
    messagesDiscovered: 0,
    messagesInserted: 0,
    duplicatesIgnored: 0,
    errorsCount: 0,
    durationMs: 0,
  }

  try {
    // 5. Fetch chats from WAHA
    const chats = options.forcedChatId
      ? [{ id: options.forcedChatId }]
      : await getWahaChats(wahaConfig, { limit: 100 })

    stats.chatsScanned = chats.length

    // 6. Iterate through each chat and pull messages since boundary
    for (const chat of chats) {
      const rawChatId = chat.id as unknown
      const chatIdStr =
        typeof rawChatId === 'string'
          ? rawChatId
          : rawChatId && typeof rawChatId === 'object' && '_serialized' in rawChatId
            ? String((rawChatId as { _serialized?: string })._serialized || '')
            : String(rawChatId || '')
      if (!chatIdStr || chatIdStr === '[object Object]') {
        stats.chatsFailed++
        continue
      }

      try {
        const rawMessages = await getWahaChatMessages(wahaConfig, chatIdStr, {
          limit: 100,
          downloadMedia: false,
          filterTimestampGte: syncFromTimestamp,
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
              chatId: chatIdStr,
            },
          }

          const normalized = normalizeWahaInbound(eventPayload, accountId)
          if (!normalized || normalized.type !== 'message') {
            continue
          }

          // Resolve WhatsApp Privacy LID to Phone Number server-side if not already resolved
          if (normalized.lid && !normalized.fromPhone) {
            try {
              const resolved = await resolveWahaLidToPhoneNumber(wahaConfig, normalized.lid)
              if (resolved) {
                normalized.fromPhone = resolved
              }
            } catch {
              // Non-fatal
            }
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

        stats.chatsSucceeded++
      } catch (chatErr) {
        stats.chatsFailed++
        stats.errorsCount++
        console.warn(`[waha-reconcile] error scanning chat ${chatIdStr}:`, chatErr)
      }
    }

    stats.durationMs = Date.now() - startTime

    // 7. Calculate clear sync status semantics
    let finalStatus: SyncStatus = 'success'
    let syncErrorMessage: string | null = null

    if (stats.chatsScanned > 0 && stats.chatsSucceeded === 0) {
      finalStatus = 'failed'
      syncErrorMessage = `Falha ao sincronizar histórico: todas as ${stats.chatsScanned} conversas falharam.`
    } else if (stats.chatsFailed > 0 || stats.errorsCount > 0) {
      finalStatus = 'partial'
      syncErrorMessage = `Sincronização parcial: ${stats.chatsFailed} de ${stats.chatsScanned} conversas falharam.`
    } else {
      finalStatus = 'success'
      syncErrorMessage = null
    }

    const upsertPayload: Record<string, unknown> = {
      account_id: accountId,
      provider: 'waha',
      session_name: configRow.waha_session_name,
      last_sync_status: finalStatus,
      last_sync_error: syncErrorMessage,
      sync_stats: stats,
      updated_at: new Date().toISOString(),
    }

    // Advance last_sync_completed_at ONLY if sync had succeeded chats
    if (finalStatus === 'success' || (finalStatus === 'partial' && stats.chatsSucceeded > 0)) {
      upsertPayload.last_sync_completed_at = new Date().toISOString()
    }

    await db.from('whatsapp_sync_state').upsert(
      upsertPayload,
      { onConflict: 'account_id,provider' }
    )

    return {
      success: finalStatus === 'success' || finalStatus === 'partial',
      status: finalStatus,
      sessionStatus,
      stats,
      error: syncErrorMessage || undefined,
    }
  } catch (err) {
    stats.durationMs = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Reconciliation failed'

    await db.from('whatsapp_sync_state').upsert(
      {
        account_id: accountId,
        provider: 'waha',
        session_name: configRow.waha_session_name,
        last_sync_status: 'failed',
        last_sync_error: errorMessage,
        sync_stats: stats,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider' }
    )

    return {
      success: false,
      status: 'failed',
      error: errorMessage,
      sessionStatus,
      stats,
    }
  }
}

/**
 * Triggers background auto-recovery reconciliation when an account session
 * is active and has a timestamp gap since the last successful sync.
 * Non-blocking, fire-and-forget with in-memory lock/cooldown.
 */
export async function maybeTriggerAutoRecovery(
  accountId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any,
  options: { minGapMinutes?: number } = {}
): Promise<void> {
  const minGapMinutes = options.minGapMinutes ?? 5
  const now = Date.now()

  // 1. In-memory cooldown per account
  const lastAttempt = _autoRecoveryLocks.get(accountId) || 0
  if (now - lastAttempt < minGapMinutes * 60 * 1000) {
    return
  }

  const client = db || getAdminClient()

  try {
    const { data: syncState } = await client
      .from('whatsapp_sync_state')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'waha')
      .maybeSingle()

    // If currently syncing and not stale (< 3 min), don't trigger
    if (syncState?.last_sync_status === 'syncing' && syncState?.last_sync_started_at) {
      const startedAt = new Date(syncState.last_sync_started_at).getTime()
      if (now - startedAt < 3 * 60 * 1000) {
        return
      }
    }

    // Check if there is a gap (> minGapMinutes since last completed sync or if failed)
    const isFailed = syncState?.last_sync_status === 'failed' || syncState?.last_sync_status === 'error'
    const lastCompleted = syncState?.last_sync_completed_at ? new Date(syncState.last_sync_completed_at).getTime() : 0
    const hasGap = !lastCompleted || (now - lastCompleted) > minGapMinutes * 60 * 1000

    if (hasGap || isFailed) {
      _autoRecoveryLocks.set(accountId, now)
      // Fire-and-forget in background without awaiting or blocking caller
      reconcileWahaMessages({
        accountId,
        db: client,
        overlapMinutes: 10,
      }).catch((err) => {
        console.error('[waha-auto-recovery] background reconciliation failed:', err)
      })
    }
  } catch (err) {
    console.warn('[waha-auto-recovery] check failed:', err)
  }
}
