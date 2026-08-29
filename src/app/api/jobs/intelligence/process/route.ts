import { NextResponse } from 'next/server'
import { processIntelligenceBatch } from '@/lib/jobs/workers/intelligence-worker'
import { sweepAndEnqueueDueIntelligence } from '@/lib/intelligence/sweep'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.AUTOMATION_CRON_SECRET
  if (!secret) return false

  const headerSecret = request.headers.get('x-cron-secret')
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  return headerSecret === secret || bearerToken === secret
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const adminDb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. Sweep eligible debounced conversations into PGMQ
    const sweepStats = await sweepAndEnqueueDueIntelligence(adminDb, { batchLimit: 25 })

    // 2. Process queued extraction batch
    const workerStats = await processIntelligenceBatch({ db: adminDb })

    return NextResponse.json(
      {
        ok: true,
        sweep: sweepStats,
        worker: workerStats,
      },
      { status: 200 }
    )
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
