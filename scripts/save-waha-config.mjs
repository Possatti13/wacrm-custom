import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const envPath = path.join(root, '.env.local')
const env = fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .reduce((acc, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return acc
    const idx = trimmed.indexOf('=')
    if (idx === -1) return acc
    acc[trimmed.slice(0, idx)] = trimmed.slice(idx + 1).replace(/^['"]|['"]$/g, '')
    return acc
  }, {})

const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY']
for (const key of required) {
  if (!env[key]) throw new Error(`Missing ${key} in .env.local`)
}

function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(env.ENCRYPTION_KEY, 'hex'), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: profiles, error: profileError } = await supabase
  .from('profiles')
  .select('user_id, account_id, created_at')
  .order('created_at', { ascending: false })
  .limit(1)

if (profileError) throw profileError
if (!profiles?.length) throw new Error('No profile found. Create/login to the CRM first.')

const profile = profiles[0]
const row = {
  account_id: profile.account_id,
  user_id: profile.user_id,
  provider: 'waha',
  phone_number_id: null,
  waba_id: null,
  access_token: encrypt('wacrm-local-dev-key'),
  verify_token: null,
  waha_base_url: 'http://localhost:3001',
  waha_session_name: 'wacrm',
  status: 'connected',
  connected_at: new Date().toISOString(),
  registered_at: null,
  subscribed_apps_at: null,
  last_registration_error: null,
  updated_at: new Date().toISOString(),
}

const { data: existing, error: existingError } = await supabase
  .from('whatsapp_config')
  .select('id')
  .eq('account_id', profile.account_id)
  .maybeSingle()
if (existingError) throw existingError

const result = existing
  ? await supabase.from('whatsapp_config').update(row).eq('id', existing.id)
  : await supabase.from('whatsapp_config').insert(row)

if (result.error) throw result.error

console.log('WAHA config saved for account:', profile.account_id)
console.log('Provider: waha')
console.log('Base URL: http://localhost:3001')
console.log('Session: wacrm')
