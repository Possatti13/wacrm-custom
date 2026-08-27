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
    try {
      const body = await request.json().catch(() => ({}))
      if (typeof body.initialSyncWindowHours === 'number') {
        initialSyncWindowHours = body.initialSyncWindowHours
      }
    } catch {
      // Body optional
    }

    const result = await reconcileWahaMessages({
      accountId,
      initialSyncWindowHours,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reconcile WAHA messages'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
