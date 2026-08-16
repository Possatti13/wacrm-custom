import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getWahaSession, startWahaSession } from '@/lib/whatsapp/waha-api'

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

async function loadWahaConfig() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const accountId = await resolveAccountId(supabase, user.id)
  if (!accountId) {
    return { error: NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 }) }
  }

  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('provider, access_token, waha_base_url, waha_session_name')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[waha/session] config lookup failed:', error)
    return { error: NextResponse.json({ error: 'Failed to load WhatsApp configuration' }, { status: 500 }) }
  }

  if (!config || config.provider !== 'waha') {
    return { error: NextResponse.json({ error: 'WAHA is not configured for this account.' }, { status: 404 }) }
  }

  if (!config.access_token || !config.waha_base_url || !config.waha_session_name) {
    return { error: NextResponse.json({ error: 'WAHA configuration is incomplete.' }, { status: 400 }) }
  }

  let apiKey: string
  try {
    apiKey = decrypt(config.access_token)
  } catch (err) {
    console.error('[waha/session] API key decrypt failed:', err)
    return { error: NextResponse.json({ error: 'WAHA API key could not be decrypted. Reset and save the connection again.' }, { status: 400 }) }
  }

  return {
    config: {
      baseUrl: config.waha_base_url as string,
      apiKey,
      session: config.waha_session_name as string,
    },
  }
}

export async function GET() {
  const loaded = await loadWahaConfig()
  if ('error' in loaded) return loaded.error

  try {
    const session = await getWahaSession(loaded.config)
    return NextResponse.json({ provider: 'waha', connected: session.status === 'WORKING', session })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown WAHA error'
    console.error('[waha/session] status failed:', message)
    return NextResponse.json({ provider: 'waha', connected: false, error: message }, { status: 502 })
  }
}

export async function POST() {
  const loaded = await loadWahaConfig()
  if ('error' in loaded) return loaded.error

  try {
    const session = await startWahaSession(loaded.config)
    return NextResponse.json({ provider: 'waha', connected: session.status === 'WORKING', session })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown WAHA error'
    console.error('[waha/session] start failed:', message)
    return NextResponse.json({ provider: 'waha', connected: false, error: message }, { status: 502 })
  }
}
