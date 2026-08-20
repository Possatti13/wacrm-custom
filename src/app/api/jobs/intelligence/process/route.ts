import { NextResponse } from 'next/server'
import { processIntelligenceBatch } from '@/lib/jobs/workers/intelligence-worker'

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
    const stats = await processIntelligenceBatch()
    return NextResponse.json({ ok: true, stats }, { status: 200 })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
