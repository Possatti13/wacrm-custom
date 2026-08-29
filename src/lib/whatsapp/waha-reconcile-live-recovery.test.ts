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

  it('runs real reconciliation against staging, recovers offline messages, filters groups/broadcasts, and remains idempotent', async () => {
    if (!isStaging || !serviceKey) {
      console.log('Skipping live staging test: not staging environment or missing credentials')
      return
    }

    const db = createClient(supabaseUrl, serviceKey)

    // 1. Fetch WAHA config
    const { data: config } = await db
      .from('whatsapp_config')
      .select('account_id, waha_session_name')
      .eq('provider_type', 'waha')
      .maybeSingle()

    if (!config) {
      console.log('No WAHA config found on staging, skipping')
      return
    }

    const accountId = config.account_id

    // 2. Run reconciliation in 'now' mode with overlap
    const runResult = await reconcileWahaMessages({
      accountId,
      db,
      mode: 'now',
      overlapMinutes: 60,
    })

    console.log('Scoped Run Result:', runResult)
    expect(runResult.success).toBe(true)
    expect(runResult.status).toBe('success')
    expect(runResult.stats?.chatsFailed).toBe(0)
    expect(runResult.stats?.chatsScanned).toBeGreaterThan(0)
    expect(runResult.stats?.chatsEligible).toBeGreaterThan(0)
    expect(runResult.stats?.chatsSkippedGroup).toBeGreaterThanOrEqual(1) // Proves group filtering live

    // Verify OFFLINE messages are in the DB
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

    // Verify ZERO groups or non-1:1 conversations were created in the database
    const { data: convs } = await db
      .from('conversations')
      .select('id, external_chat_id')

    expect(convs).not.toBeNull()
    for (const c of convs || []) {
      expect(c.external_chat_id).not.toContain('@g.us')
      expect(c.external_chat_id).not.toContain('@broadcast')
      expect(c.external_chat_id).not.toContain('@newsletter')
    }

    // 3. Second run must be fully idempotent (0 new messages inserted)
    const secondRun = await reconcileWahaMessages({
      accountId,
      db,
      mode: 'now',
      overlapMinutes: 60,
    })

    console.log('Second Run Result (Idempotency):', secondRun)
    expect(secondRun.success).toBe(true)
    expect(secondRun.stats?.messagesInserted).toBe(0)

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
    expect(syncState.sync_stats.chatsEligible).toBeGreaterThan(0)
  }, 60000)
})
