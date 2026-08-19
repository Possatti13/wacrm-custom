import type {
  RawModelObservation,
  ValidatedObservation,
  ValidatedEvidenceItem,
  ClaimMessageItem,
  CatalogItemContextSnapshot,
} from './types'
import type { CanonicalConfigSnapshot } from '@/lib/commercial-config/types'
import { matchQuotedEvidenceSpan } from './evidence-matcher'
import { computeInsightDedupeKey } from '@/lib/insights/dedupe'
import { normalizeObjection } from '@/lib/leads/normalization'

export interface ResolutionContext {
  configSnapshot: CanonicalConfigSnapshot
  catalogSnapshot: CatalogItemContextSnapshot[]
  messageRefMap: Map<string, ClaimMessageItem>
  extractorVersion: string
}

export function resolveCatalogTermFromPinnedContext(
  catalogSnapshot: CatalogItemContextSnapshot[],
  term: string | null | undefined
): { catalogItemId: string | null; canonicalName: string | null } {
  if (!term || typeof term !== 'string' || term.trim().length === 0) {
    return { catalogItemId: null, canonicalName: null }
  }

  const cleanTerm = term.trim().toLowerCase()

  // 1. Check exact match on item name
  const exactItem = catalogSnapshot.find((c) => c.name.trim().toLowerCase() === cleanTerm)
  if (exactItem) {
    return { catalogItemId: exactItem.id, canonicalName: exactItem.name }
  }

  // 2. Check match on terms / aliases
  for (const item of catalogSnapshot) {
    for (const t of item.terms || []) {
      if (t.normalized_term === cleanTerm || t.term.trim().toLowerCase() === cleanTerm) {
        return { catalogItemId: item.id, canonicalName: item.name }
      }
    }
  }

  return { catalogItemId: null, canonicalName: null }
}

export function resolveAndValidateObservation(
  obs: RawModelObservation,
  ctx: ResolutionContext
): ValidatedObservation | null {
  if (!obs || typeof obs !== 'object') {
    return null
  }

  const type = obs.type
  if (!['interest', 'objection', 'intent', 'urgency', 'sentiment', 'next_action', 'summary', 'attribute'].includes(type)) {
    return null
  }

  let valueText: string | null = null
  let valueJson: Record<string, unknown> = {}
  let catalogItemId: string | null = null

  // 1. Resolve Interest
  if (type === 'interest') {
    const rawTerm = (obs.catalog_term || (typeof obs.value === 'string' ? obs.value : '')).trim()
    const resolved = resolveCatalogTermFromPinnedContext(ctx.catalogSnapshot, rawTerm)
    catalogItemId = resolved.catalogItemId
    valueText = resolved.canonicalName || rawTerm || 'Interesse identificado'
    if (!catalogItemId && !valueText) {
      return null
    }
  }

  // 2. Resolve Intent
  else if (type === 'intent') {
    const rawKey = typeof obs.value === 'string' ? obs.value.trim().toLowerCase() : ''
    const activeIntents = (ctx.configSnapshot.intents || []).filter((i) => i.status === 'active')
    const matchedIntent = activeIntents.find((i) => i.key === rawKey)
    if (!matchedIntent) {
      // Rejects invented intent keys
      return null
    }
    valueText = matchedIntent.key
    valueJson = { label: matchedIntent.label }
  }

  // 3. Resolve Attribute
  else if (type === 'attribute') {
    const rawAttrKey = (obs.attribute_key || '').trim().toLowerCase()
    const activeAttrs = (ctx.configSnapshot.attributes || []).filter((a) => a.status === 'active')
    const matchedAttr = activeAttrs.find((a) => a.key === rawAttrKey)
    if (!matchedAttr) {
      // Rejects unknown/inactive attribute keys
      return null
    }

    // Validate and normalize value against attribute type
    if (matchedAttr.value_type === 'single_select') {
      const rawVal = typeof obs.value === 'string' ? obs.value.trim().toLowerCase() : ''
      const opt = matchedAttr.options.find((o) => o.key === rawVal)
      if (!opt) return null
      valueText = opt.key
      valueJson = { attribute_key: matchedAttr.key, label: opt.label, value: opt.key }
    } else if (matchedAttr.value_type === 'multi_select') {
      const rawArr = Array.isArray(obs.value) ? obs.value : [obs.value]
      const validKeys = new Set(matchedAttr.options.map((o) => o.key))
      const selected: string[] = []
      for (const item of rawArr) {
        const k = String(item).trim().toLowerCase()
        if (validKeys.has(k)) selected.push(k)
      }
      if (selected.length === 0) return null
      valueText = selected.join(', ')
      valueJson = { attribute_key: matchedAttr.key, selected }
    } else if (matchedAttr.value_type === 'number') {
      const num = Number(obs.value)
      if (isNaN(num)) return null
      valueText = String(num)
      valueJson = { attribute_key: matchedAttr.key, value: num }
    } else if (matchedAttr.value_type === 'boolean') {
      const b = obs.value === true || obs.value === 'true'
      valueText = b ? 'true' : 'false'
      valueJson = { attribute_key: matchedAttr.key, value: b }
    } else {
      valueText = typeof obs.value === 'string' ? obs.value.trim() : JSON.stringify(obs.value)
      valueJson = { attribute_key: matchedAttr.key, value: valueText }
    }
  }

  // 4. Resolve Objection
  else if (type === 'objection') {
    const rawVal = typeof obs.value === 'string' ? obs.value : JSON.stringify(obs.value)
    valueText = normalizeObjection(rawVal)
  }

  // 5. Other Types (urgency, sentiment, next_action, summary)
  else {
    if (typeof obs.value === 'object' && obs.value !== null) {
      valueJson = obs.value as Record<string, unknown>
      valueText = null
    } else {
      valueText = typeof obs.value === 'string' ? obs.value.trim() : String(obs.value)
    }
  }

  // 6. Resolve & Match Evidence
  const validatedEvidences: ValidatedEvidenceItem[] = []
  if (Array.isArray(obs.evidence)) {
    for (const ev of obs.evidence) {
      if (!ev || typeof ev !== 'object') continue
      const msgItem = ctx.messageRefMap.get(ev.message_ref)
      if (!msgItem) continue

      const matchRes = matchQuotedEvidenceSpan(msgItem.content_text, ev.quoted_text)
      if (matchRes.matched && matchRes.start_offset !== undefined && matchRes.end_offset !== undefined) {
        validatedEvidences.push({
          message_id: msgItem.id,
          start_offset: matchRes.start_offset,
          end_offset: matchRes.end_offset,
          snippet: matchRes.snippet || ev.quoted_text,
        })
      }
    }
  }

  // Deduplication Key (using deterministic SHA-256 fingerprint from Phase 3C)
  const dedupeKey = computeInsightDedupeKey({
    insightType: type,
    catalogItemId,
    valueText,
    evidence: validatedEvidences.map((e) => ({
      message_id: e.message_id,
      start_offset: e.start_offset,
      end_offset: e.end_offset,
      snippet: e.snippet,
    })),
    extractorVersion: ctx.extractorVersion,
  })

  const confidence = typeof obs.confidence === 'number' && obs.confidence >= 0 && obs.confidence <= 1
    ? Math.round(obs.confidence * 1000) / 1000
    : null

  // Derive chronological observed_at from cited evidence messages
  let observedAt: string | undefined = undefined
  if (validatedEvidences.length > 0) {
    let latestTs: number | null = null
    for (const ev of validatedEvidences) {
      for (const msg of ctx.messageRefMap.values()) {
        if (msg.id === ev.message_id && msg.created_at) {
          const ts = new Date(msg.created_at).getTime()
          if (latestTs === null || ts > latestTs) {
            latestTs = ts
            observedAt = msg.created_at
          }
        }
      }
    }
  }

  return {
    insight_type: type,
    value_text: valueText,
    value_json: valueJson,
    catalog_item_id: catalogItemId,
    confidence,
    source: 'intelligence',
    dedupe_key: dedupeKey,
    evidence: validatedEvidences,
    observed_at: observedAt,
  }
}
