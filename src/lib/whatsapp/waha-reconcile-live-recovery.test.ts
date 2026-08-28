/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { reconcileWahaMessages } from './providers/waha/reconciliation'
import fs from 'fs'
import dotenv from 'dotenv'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k of Object.keys(envConfig)) {
    process.env[k] = envConfig[k]
  }
}

describe('WAHA Real Recovery Test — Staging Invariant', () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const isStaging = supabaseUrl.includes('pxpnkaakurjwpfuezpob')

  it('runs real reconciliation against staging, recovers offline messages, and remains idempotent', async () => {
    if (!isStaging || !serviceKey) {
      console.log('Skipping live staging test: not staging environment or missing credentials')
      return
    }

    const db = createClient(supabaseUrl, serviceKey)

    // 1. Fetch WAHA config
    const { data: config } = await db
      .from('whatsapp_config')
      .select('account_id, waha_session_name')
      .eq('provider', 'waha')
      .maybeSingle()

    if (!config) {
      console.log('No WAHA config found on staging, skipping')
      return
    }

    const accountId = config.account_id

    // 2. Run reconciliation with a 24h window to ensure offline messages are scanned
    const firstRun = await reconcileWahaMessages({
      accountId,
      db,
      initialSyncWindowHours: 24,
      overlapMinutes: 1440,
    })

    console.log('First Run Result:', firstRun)
    expect(firstRun.success).toBe(true)
    expect(firstRun.status).toBe('success')
    expect(firstRun.stats?.chatsFailed).toBe(0)
    expect(firstRun.stats?.chatsScanned).toBeGreaterThan(0)
    expect(firstRun.stats?.chatsSucceeded).toBe(firstRun.stats?.chatsScanned)

    // Verify OFFLINE messages are now in the DB
    const { data: messages } = await db
      .from('messages')
      .select('id, message_id, content_text')
      .ilike('content_text', '%OFFLINE CICLOPES%')

    expect(messages).not.toBeNull()
    const bodies = (messages || []).map((m: any) => m.content_text)
    console.log('Recovered offline messages in DB:', bodies)
    expect(bodies).toContain('OFFLINE CICLOPES 01')
    expect(bodies).toContain('OFFLINE CICLOPES 02')
    expect(bodies).toContain('OFFLINE CICLOPES 03')

    // 3. Second run must be fully idempotent (0 new messages inserted, duplicates ignored)
    const secondRun = await reconcileWahaMessages({
      accountId,
      db,
      overlapMinutes: 60,
    })

    console.log('Second Run Result (Idempotency):', secondRun)
    expect(secondRun.success).toBe(true)
    expect(secondRun.stats?.messagesInserted).toBe(0)
    expect(secondRun.stats?.duplicatesIgnored).toBeGreaterThanOrEqual(3)

    // Verify sync state in DB
    const { data: syncState } = await db
      .from('whatsapp_sync_state')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'waha')
      .single()

    expect(syncState.last_sync_status).toBe('success')
    expect(syncState.last_sync_error).toBeNull()
    expect(syncState.last_sync_completed_at).not.toBeNull()
    expect(syncState.sync_stats.chatsFailed).toBe(0)
    expect(syncState.sync_stats.chatsScanned).toBeGreaterThan(0)
  }, 60000)
})
