import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileWahaMessages } from '@/lib/whatsapp/providers/waha/reconciliation'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Profile is not linked to an account.' }, { status: 403 })
    }

    const { data: syncState } = await supabase
      .from('whatsapp_sync_state')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'waha')
      .maybeSingle()

    return NextResponse.json({
      provider: 'waha',
      sync_state: syncState || {
        last_sync_status: 'idle',
        last_sync_completed_at: null,
        sync_stats: null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown sync state error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Profile is not linked to an account.' }, { status: 403 })
    }

    let initialSyncWindowHours: number | undefined
    let mode: 'now' | '24h' | '7d' | '30d' | undefined
    let waitForCompletion = false

    try {
      const body = await request.json().catch(() => ({}))
      if (typeof body.initialSyncWindowHours === 'number') {
        initialSyncWindowHours = body.initialSyncWindowHours
      }
      if (['now', '24h', '7d', '30d'].includes(body.mode)) {
        mode = body.mode
      } else if (typeof initialSyncWindowHours === 'number') {
        mode =
          initialSyncWindowHours === 24
            ? '24h'
            : initialSyncWindowHours === 168
              ? '7d'
              : initialSyncWindowHours === 720
                ? '30d'
                : 'now'
      }

      if (body.waitForCompletion === true || body.sync === true) {
        waitForCompletion = true
      }

      if (mode) {
        await supabase
          .from('whatsapp_config')
          .update({
            history_import_mode: mode,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
      }
    } catch {
      // Body optional
    }

    if (waitForCompletion) {
      const result = await reconcileWahaMessages({
        accountId,
        mode,
        initialSyncWindowHours,
      })
      return NextResponse.json(result)
    }

    // Default: Asynchronous non-blocking background reconciliation
    // Mark sync state as 'syncing' immediately so client sees instant progress
    await supabase.from('whatsapp_sync_state').upsert(
      {
        account_id: accountId,
        provider: 'waha',
        last_sync_started_at: new Date().toISOString(),
        last_sync_status: 'syncing',
        last_sync_error: null,
        sync_stats: {
          historyMode: mode || 'now',
          chatsDiscovered: 0,
          chatsProcessed: 0,
          messagesDiscovered: 0,
          messagesInserted: 0,
          duplicatesIgnored: 0,
          errorsCount: 0,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider' }
    )

    // Fire and forget in background
    reconcileWahaMessages({
      accountId,
      mode,
      initialSyncWindowHours,
    }).catch((err) => {
      console.error('[waha-sync-route] background reconciliation failed:', err)
    })

    return NextResponse.json({
      success: true,
      status: 'syncing',
      message: 'Sincronização de histórico iniciada em segundo plano.',
      mode: mode || 'now',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reconcile WAHA messages'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
