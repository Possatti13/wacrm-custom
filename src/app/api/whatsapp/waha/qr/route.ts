import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'

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

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
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
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('provider, access_token, waha_base_url, waha_session_name')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[waha/qr] config lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load WhatsApp configuration' }, { status: 500 })
    }

    if (!config || config.provider !== 'waha') {
      return NextResponse.json({ error: 'WAHA is not configured for this account.' }, { status: 404 })
    }

    if (!config.access_token || !config.waha_base_url || !config.waha_session_name) {
      return NextResponse.json({ error: 'WAHA configuration is incomplete.' }, { status: 400 })
    }

    let apiKey: string
    try {
      apiKey = decrypt(config.access_token)
    } catch (err) {
      console.error('[waha/qr] API key decrypt failed:', err)
      return NextResponse.json({ error: 'WAHA API key could not be decrypted. Reset and save again.' }, { status: 400 })
    }

    const url = `${cleanBaseUrl(config.waha_base_url as string)}/api/${encodeURIComponent(
      config.waha_session_name as string,
    )}/auth/qr`

    const upstream = await fetch(url, {
      headers: { 'X-Api-Key': apiKey },
      cache: 'no-store',
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return NextResponse.json(
        {
          error:
            upstream.status === 422
              ? 'QR Code indisponível porque a sessão provavelmente já está conectada.'
              : text || upstream.statusText,
        },
        { status: upstream.status },
      )
    }

    const contentType = upstream.headers.get('content-type') || 'image/png'
    const body = await upstream.arrayBuffer()
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown WAHA QR error'
    console.error('[waha/qr] failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
