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
import type { WhatsAppHistoryImportMode } from '@/types'

export interface ReconcileOptions {
  accountId: string
  db?: SupabaseClient
  overlapMinutes?: number
  initialSyncWindowHours?: number
  mode?: WhatsAppHistoryImportMode
  forcedChatId?: string
}

export interface ReconcileStats {
  windowStart: string
  windowEnd: string
  historyMode: WhatsAppHistoryImportMode
  chatsScanned: number
  chatsEligible: number
  chatsSkippedGroup: number
  chatsSkippedBroadcast: number
  chatsSkippedBeforeBaseline: number
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
 * Validates if a chatId is eligible for 1:1 CRM sync.
 * Rejects groups (@g.us), broadcasts (@broadcast), newsletters/channels (@newsletter), and status updates.
 */
export function isEligibleWahaChat(chatId: string): boolean {
  if (!chatId || typeof chatId !== 'string') return false
  const lower = chatId.toLowerCase().trim()
  if (lower === '[object object]') return false

  // Reject groups
  if (lower.endsWith('@g.us')) return false

  // Reject broadcasts and status updates
  if (lower.endsWith('@broadcast') || lower.includes('status@') || lower.includes('broadcast')) return false

  // Reject channels / newsletters
  if (lower.endsWith('@newsletter') || lower.includes('newsletter')) return false

  // Accept 1:1 direct contacts: @c.us, @lid, or pure digits
  if (lower.endsWith('@c.us') || lower.endsWith('@lid')) return true

  return /^\d{7,16}$/.test(lower)
}

/**
 * Reconciles messages from WAHA for a given account.
 * Implements strict temporal boundaries, chat type filtering,
 * overlap protection window, pagination, idempotency, and records telemetry.
 */
export async function reconcileWahaMessages(
  options: ReconcileOptions
): Promise<ReconcileResult> {
  const startTime = Date.now()
  const db = options.db || getAdminClient()
  const accountId = options.accountId
  const overlapMinutes = options.overlapMinutes ?? 10

  // 1. Fetch WAHA configuration and history policy for this account
  const { data: configRow, error: configError } = await db
    .from('whatsapp_config')
    .select(
      'provider, access_token, waha_base_url, waha_session_name, history_import_mode, history_import_started_at, recovery_not_before, connected_at, created_at'
    )
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

  // 3. Determine History Mode and Strict Temporal Window
  const historyMode: WhatsAppHistoryImportMode =
    options.mode ??
    (options.initialSyncWindowHours === 24
      ? '24h'
      : options.initialSyncWindowHours === 168
        ? '7d'
        : options.initialSyncWindowHours === 720
          ? '30d'
          : (configRow.history_import_mode as WhatsAppHistoryImportMode) ?? 'now')

  // Baseline timestamp / recovery floor: the exact moment the tenant/session connected or policy started
  const rawBaseline =
    configRow.recovery_not_before ||
    configRow.history_import_started_at ||
    configRow.connected_at ||
    configRow.created_at ||
    new Date().toISOString()

  const baselineTimestamp = Math.floor(new Date(rawBaseline).getTime() / 1000)
  const nowTimestamp = Math.floor(Date.now() / 1000)

  // Load previous sync boundary from whatsapp_sync_state
  const { data: syncState } = await db
    .from('whatsapp_sync_state')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'waha')
    .maybeSingle()

  let syncFromTimestamp: number

  if (historyMode === 'now') {
    // Mode "Apenas novas mensagens (a partir de agora)"
    if (
      syncState?.last_sync_completed_at &&
      syncState?.last_sync_status !== 'failed' &&
      syncState?.last_sync_status !== 'error'
    ) {
      const lastCompleted = new Date(syncState.last_sync_completed_at).getTime()
      const candidate = Math.floor((lastCompleted - overlapMinutes * 60 * 1000) / 1000)
      // Must NEVER go before recovery_not_before baseline
      syncFromTimestamp = Math.max(candidate, baselineTimestamp)
    } else {
      // Default: start at baseline floor
      syncFromTimestamp = baselineTimestamp
    }
  } else if (historyMode === '24h') {
    syncFromTimestamp = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000)
  } else if (historyMode === '7d') {
    syncFromTimestamp = Math.floor((Date.now() - 7 * 24 * 3600 * 1000) / 1000)
  } else if (historyMode === '30d') {
    syncFromTimestamp = Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000)
  } else {
    syncFromTimestamp = baselineTimestamp
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
    windowStart: new Date(syncFromTimestamp * 1000).toISOString(),
    windowEnd: new Date(nowTimestamp * 1000).toISOString(),
    historyMode,
    chatsScanned: 0,
    chatsEligible: 0,
    chatsSkippedGroup: 0,
    chatsSkippedBroadcast: 0,
    chatsSkippedBeforeBaseline: 0,
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

      const lowerChatId = chatIdStr.toLowerCase()

      // Filter: Skip group chats
      if (chat.isGroup || lowerChatId.endsWith('@g.us')) {
        stats.chatsSkippedGroup++
        continue
      }

      // Filter: Skip broadcast, status, newsletter/channel
      if (
        lowerChatId.endsWith('@broadcast') ||
        lowerChatId.endsWith('@newsletter') ||
        lowerChatId.includes('status@') ||
        lowerChatId.includes('broadcast') ||
        lowerChatId.includes('newsletter')
      ) {
        stats.chatsSkippedBroadcast++
        continue
      }

      // Filter: Must be eligible 1:1 chat
      if (!isEligibleWahaChat(chatIdStr)) {
        stats.chatsSkippedBroadcast++
        continue
      }

      // Filter: If chat has a known last activity timestamp strictly before the recovery floor, skip it
      if (typeof chat.timestamp === 'number' && chat.timestamp > 0 && chat.timestamp < syncFromTimestamp) {
        stats.chatsSkippedBeforeBaseline++
        continue
      }

      stats.chatsEligible++

      try {
        const rawMessages = await getWahaChatMessages(wahaConfig, chatIdStr, {
          limit: 100,
          downloadMedia: false,
          filterTimestampGte: syncFromTimestamp,
          filterTimestampLte: nowTimestamp,
        })

        // Sort chronologically ascending so replay preserves true message order
        const filtered = rawMessages
          .filter(
            (m) =>
              typeof m.timestamp === 'number' &&
              m.timestamp >= syncFromTimestamp &&
              m.timestamp <= nowTimestamp
          )
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

    if (stats.chatsEligible > 0 && stats.chatsSucceeded === 0) {
      finalStatus = 'failed'
      syncErrorMessage = `Falha ao sincronizar histórico: todas as ${stats.chatsEligible} conversas elegíveis falharam.`
    } else if (stats.chatsFailed > 0 || stats.errorsCount > 0) {
      finalStatus = 'partial'
      syncErrorMessage = `Sincronização parcial: ${stats.chatsFailed} de ${stats.chatsEligible} conversas falharam.`
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

    // Advance last_sync_completed_at ONLY if sync had succeeded chats or 0 eligible chats
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
