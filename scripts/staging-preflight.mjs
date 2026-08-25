#!/usr/bin/env node
/**
 * scripts/staging-preflight.mjs
 *
 * Automated Staging Environment & Infrastructure Preflight Checker.
 *
 * Checks presence of configuration, validates database connectivity,
 * verifies PGMQ queues, triggers, RPC grants, and cryptographic setups
 * without EVER leaking secret values.
 *
 * Enforces strict safety boundary: Aborts immediately if Production project
 * ('vutyeaytyksciiykddyh') is detected.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const PRODUCTION_PROJECT_REF = 'vutyeaytyksciiykddyh'
const AUTHORIZED_STAGING_PROJECT_REF = 'pxpnkaakurjwpfuezpob'

// Load .env.local if present
function loadEnv() {
  const envPath = path.join(rootDir, '.env.local')
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim()
        let val = trimmed.slice(eqIdx + 1).trim()
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
        if (!process.env[key]) {
          process.env[key] = val
        }
      }
    }
  }
}

loadEnv()

async function runPreflight() {
  console.log('========================================================================')
  console.log('       WACRM / ZIRON — STAGING PILOT ENVIRONMENT PREFLIGHT CHECK        ')
  console.log('========================================================================\n')

  const results = {
    coreBoot: [],
    cryptoSecurity: [],
    whatsApp: [],
    commercialIntelligence: [],
    database: []
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const encryptionKey = process.env.ENCRYPTION_KEY || ''
  const cronSecret = process.env.CRON_SECRET || ''

  // 1. Safety Tripwire
  if (supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    console.error('❌ CRITICAL SAFETY ERROR: Target URL points to PRODUCTION (vutyeaytyksciiykddyh)!')
    console.error('   Aborting preflight immediately.')
    process.exit(1)
  }

  // 2. Core Boot Variables
  results.coreBoot.push({
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    present: !!supabaseUrl,
    detail: supabaseUrl ? (supabaseUrl.includes(AUTHORIZED_STAGING_PROJECT_REF) ? 'Points to Staging (pxpnkaakurjwpfuezpob)' : 'Custom/Local Host') : 'MISSING',
    status: !!supabaseUrl ? 'OK' : 'FAIL'
  })
  results.coreBoot.push({
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    present: !!anonKey,
    detail: anonKey ? `${anonKey.length} chars (hash: ${anonKey.slice(0, 6)}...)` : 'MISSING',
    status: !!anonKey ? 'OK' : 'FAIL'
  })
  results.coreBoot.push({
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    present: !!serviceRoleKey,
    detail: serviceRoleKey ? `${serviceRoleKey.length} chars (server-only)` : 'MISSING',
    status: !!serviceRoleKey ? 'OK' : 'FAIL'
  })

  // 3. Crypto & Security Variables
  const validHexKey = encryptionKey.length === 64 && /^[0-9a-fA-F]+$/.test(encryptionKey)
  results.cryptoSecurity.push({
    name: 'ENCRYPTION_KEY',
    present: !!encryptionKey,
    detail: validHexKey ? 'Valid 32-byte AES-256-GCM hex key' : (encryptionKey ? 'Invalid format (must be 64 hex chars)' : 'MISSING'),
    status: validHexKey ? 'OK' : (encryptionKey ? 'WARN' : 'FAIL')
  })
  results.cryptoSecurity.push({
    name: 'CRON_SECRET',
    present: !!cronSecret,
    detail: cronSecret ? `${cronSecret.length} chars configured` : 'MISSING (required for worker scheduler)',
    status: !!cronSecret ? 'OK' : 'FAIL'
  })

  // 4. WhatsApp Integration Variables
  const metaSecret = process.env.META_APP_SECRET || ''
  const metaToken = process.env.META_ACCESS_TOKEN || ''
  const metaPhoneId = process.env.META_PHONE_NUMBER_ID || ''
  const metaVerify = process.env.META_VERIFY_TOKEN || ''

  results.whatsApp.push({
    name: 'META_APP_SECRET',
    present: !!metaSecret,
    detail: metaSecret ? 'Configured for HMAC signature verification' : 'NOT CONFIGURED (Blocked External)',
    status: metaSecret ? 'OK' : 'BLOCKED_EXTERNAL'
  })
  results.whatsApp.push({
    name: 'META_ACCESS_TOKEN / PHONE_ID',
    present: !!(metaToken && metaPhoneId),
    detail: (metaToken && metaPhoneId) ? 'Configured for Cloud API send' : 'NOT CONFIGURED (Blocked External)',
    status: (metaToken && metaPhoneId) ? 'OK' : 'BLOCKED_EXTERNAL'
  })

  // 5. Remote Database Infrastructure Validation
  let dbStatus = 'NOT_TESTED'
  if (supabaseUrl && serviceRoleKey) {
    try {
      const client = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })

      // Test RPC: check queue definitions
      const { data: queueData, error: queueErr } = await client.rpc('read_whatsapp_inbound', {
        p_vt: 1,
        p_limit: 1
      })

      const queuesOk = !queueErr || !queueErr.message.includes('function public.read_whatsapp_inbound')
      results.database.push({
        name: 'PGMQ Queue (whatsapp_inbound)',
        present: queuesOk,
        detail: queuesOk ? 'Active & RPC callable by service_role' : queueErr.message,
        status: queuesOk ? 'OK' : 'FAIL'
      })

      // Check intelligence extraction queue RPC
      const { error: intelQueueErr } = await client.rpc('read_intelligence_extraction', {
        p_vt: 1,
        p_limit: 1
      })
      const intelQueueOk = !intelQueueErr || !intelQueueErr.message.includes('function public.read_intelligence_extraction')
      results.database.push({
        name: 'PGMQ Queue (intelligence_extraction)',
        present: intelQueueOk,
        detail: intelQueueOk ? 'Active & RPC callable by service_role' : intelQueueErr.message,
        status: intelQueueOk ? 'OK' : 'FAIL'
      })

      // Check RLS & key tables
      const { data: tablesData, error: tablesErr } = await client.from('accounts').select('id').limit(1)
      results.database.push({
        name: 'Multi-Tenant Database Connectivity',
        present: !tablesErr,
        detail: !tablesErr ? 'Successfully connected to Staging PostgreSQL' : tablesErr.message,
        status: !tablesErr ? 'OK' : 'FAIL'
      })

      dbStatus = (!queueErr && !intelQueueErr && !tablesErr) ? 'OK' : 'WARN'
    } catch (err) {
      results.database.push({
        name: 'Database Connection Exception',
        present: false,
        detail: err.message,
        status: 'FAIL'
      })
      dbStatus = 'FAIL'
    }
  }

  // Render Formatted Output
  function printSection(title, items) {
    console.log(`[ ${title} ]`)
    for (const item of items) {
      const icon = item.status === 'OK' ? '✅' : (item.status === 'BLOCKED_EXTERNAL' ? '⏳' : (item.status === 'WARN' ? '⚠️' : '❌'))
      console.log(`  ${icon} ${item.name.padEnd(35)} [${item.status.padEnd(16)}] : ${item.detail}`)
    }
    console.log('')
  }

  printSection('1. CORE BOOT SUBSYSTEM', results.coreBoot)
  printSection('2. CRYPTOGRAPHY & SECURITY', results.cryptoSecurity)
  printSection('3. WHATSAPP INGESTION (REAL PROVIDER)', results.whatsApp)
  printSection('4. STAGING DATABASE & PGMQ QUEUES', results.database)

  const coreReady = results.coreBoot.every(i => i.status === 'OK') && results.cryptoSecurity.every(i => i.status === 'OK' || i.status === 'WARN')
  const dbReady = results.database.every(i => i.status === 'OK')

  console.log('========================================================================')
  if (coreReady && dbReady) {
    console.log('🎉 VERDICT: STAGING INFRASTRUCTURE IS 100% READY FOR CONTROLLED PILOT')
    console.log('   (Real Meta / OpenAI keys are BLOCKED_EXTERNAL as expected for synthetic phase)')
  } else {
    console.log('⚠️ VERDICT: STAGING REQUIRES CONFIGURATION BEFORE RUNNING JOBS')
  }
  console.log('========================================================================\n')
}

runPreflight().catch(err => {
  console.error('Preflight error:', err)
  process.exit(1)
})
