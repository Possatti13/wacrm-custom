import type { SupabaseClient } from '@supabase/supabase-js'
import type { CanonicalLeadScoringInput } from './types'
import { validateUuid } from '../leads/validation'

export async function buildCanonicalLeadScoringInput(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<CanonicalLeadScoringInput> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  // 1. Fetch Profile
  const { data: profile } = await db
    .from('contact_lead_profiles')
    .select('current_intent, urgency, sentiment, next_action, attributes')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .maybeSingle()

  // 2. Fetch Active Interests
  const { data: interests } = await db
    .from('contact_catalog_interests')
    .select('catalog_item_id')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .eq('status', 'active')
    .order('catalog_item_id', { ascending: true })

  // 3. Fetch Open Objections
  const { data: objections } = await db
    .from('contact_objections')
    .select('normalized_objection')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .eq('status', 'open')
    .order('normalized_objection', { ascending: true })

  const activeItemIds: string[] = (interests || [])
    .map((i) => i.catalog_item_id as string)
    .filter(Boolean)
    .sort()

  const openKeys: string[] = (objections || [])
    .map((o) => o.normalized_objection as string)
    .filter(Boolean)
    .sort()

  return {
    profile: {
      current_intent: profile?.current_intent ?? null,
      urgency: profile?.urgency ?? null,
      sentiment: profile?.sentiment ?? null,
      next_action: profile?.next_action ?? null,
      attributes: (profile?.attributes as Record<string, unknown>) ?? {},
    },
    interests: {
      active_item_ids: activeItemIds,
    },
    objections: {
      open_keys: openKeys,
      has_open: openKeys.length > 0,
    },
    engagement: {
      active_interests_count: activeItemIds.length,
      open_objections_count: openKeys.length,
    },
  }
}
