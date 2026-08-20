import { createHash } from 'crypto'
import type {
  LeadScoringSnapshot,
  LeadScoringSnapshotRule,
  CanonicalLeadScoringInput,
  LeadScoreContribution,
  ScoringCalculationResult,
} from './types'

// ============================================================
// Deterministic Canonicalization & Hashing
// ============================================================

export function canonicalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJson)
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort()
  const result: Record<string, unknown> = {}
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson((obj as Record<string, unknown>)[key])
  }
  return result
}

export function computeScoringInputFingerprint(
  revisionId: string,
  snapshotHash: string,
  input: CanonicalLeadScoringInput
): string {
  const canonicalInput = canonicalizeJson(input)
  const payload = `${revisionId}#${snapshotHash}#${JSON.stringify(canonicalInput)}`
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

// ============================================================
// Rule Evaluator (Pure Function)
// ============================================================

export function evaluateRuleMatch(
  rule: LeadScoringSnapshotRule,
  input: CanonicalLeadScoringInput
): { matched: boolean; matchedValueDescription: string | null } {
  const { signal_type, field_key, operator, expected_value } = rule

  // 1. Profile Field Evaluation
  if (signal_type === 'profile_field') {
    let actualVal: string | null = null
    if (field_key === 'current_intent') actualVal = input.profile.current_intent
    else if (field_key === 'urgency') actualVal = input.profile.urgency
    else if (field_key === 'sentiment') actualVal = input.profile.sentiment
    else if (field_key === 'next_action') actualVal = input.profile.next_action

    if (operator === 'equals') {
      const exp = typeof expected_value === 'string' ? expected_value : String(expected_value ?? '')
      const matched = actualVal === exp
      return { matched, matchedValueDescription: actualVal }
    } else if (operator === 'not_equals') {
      const exp = typeof expected_value === 'string' ? expected_value : String(expected_value ?? '')
      const matched = actualVal !== null && actualVal !== exp
      return { matched, matchedValueDescription: actualVal }
    } else if (operator === 'in') {
      const arr = Array.isArray(expected_value) ? expected_value.map(String) : []
      const matched = actualVal !== null && arr.includes(actualVal)
      return { matched, matchedValueDescription: actualVal }
    } else if (operator === 'exists') {
      const matched = actualVal !== null && actualVal.trim().length > 0
      return { matched, matchedValueDescription: actualVal }
    } else if (operator === 'not_exists') {
      const matched = actualVal === null || actualVal.trim().length === 0
      return { matched, matchedValueDescription: actualVal }
    }
  }

  // 2. Attribute Evaluation
  else if (signal_type === 'attribute') {
    if (!field_key) return { matched: false, matchedValueDescription: null }
    const hasKey = Object.prototype.hasOwnProperty.call(input.profile.attributes, field_key)
    const rawVal = input.profile.attributes[field_key]

    if (operator === 'exists') {
      return { matched: hasKey && rawVal !== null && rawVal !== undefined, matchedValueDescription: String(rawVal) }
    } else if (operator === 'not_exists') {
      return { matched: !hasKey || rawVal === null || rawVal === undefined, matchedValueDescription: null }
    }

    if (!hasKey || rawVal === null || rawVal === undefined) {
      return { matched: false, matchedValueDescription: null }
    }

    const actualStr = typeof rawVal === 'object' ? JSON.stringify(rawVal) : String(rawVal)

    if (operator === 'equals') {
      const expStr = typeof expected_value === 'object' ? JSON.stringify(expected_value) : String(expected_value ?? '')
      return { matched: actualStr === expStr, matchedValueDescription: actualStr }
    } else if (operator === 'not_equals') {
      const expStr = typeof expected_value === 'object' ? JSON.stringify(expected_value) : String(expected_value ?? '')
      return { matched: actualStr !== expStr, matchedValueDescription: actualStr }
    } else if (operator === 'in') {
      const arr = Array.isArray(expected_value) ? expected_value.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))) : []
      return { matched: arr.includes(actualStr), matchedValueDescription: actualStr }
    } else if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
      const numActual = typeof rawVal === 'number' ? rawVal : Number(rawVal)
      const numExpected = typeof expected_value === 'number' ? expected_value : Number(expected_value)
      if (isNaN(numActual) || isNaN(numExpected)) {
        return { matched: false, matchedValueDescription: actualStr }
      }
      let matched = false
      if (operator === 'gt') matched = numActual > numExpected
      else if (operator === 'gte') matched = numActual >= numExpected
      else if (operator === 'lt') matched = numActual < numExpected
      else if (operator === 'lte') matched = numActual <= numExpected
      return { matched, matchedValueDescription: actualStr }
    }
  }

  // 3. Catalog Interest Evaluation (by item_id)
  else if (signal_type === 'catalog_interest') {
    const activeItemIds = input.interests.active_item_ids || []
    if (operator === 'exists') {
      if (field_key && field_key.trim().length > 0) {
        const matched = activeItemIds.includes(field_key.trim())
        return { matched, matchedValueDescription: field_key }
      }
      return { matched: activeItemIds.length > 0, matchedValueDescription: String(activeItemIds.length) }
    } else if (operator === 'not_exists') {
      if (field_key && field_key.trim().length > 0) {
        const matched = !activeItemIds.includes(field_key.trim())
        return { matched, matchedValueDescription: null }
      }
      return { matched: activeItemIds.length === 0, matchedValueDescription: '0' }
    } else if (operator === 'in') {
      const arr = Array.isArray(expected_value) ? expected_value.map(String) : []
      const matched = arr.some(id => activeItemIds.includes(id))
      return { matched, matchedValueDescription: arr.filter(id => activeItemIds.includes(id)).join(', ') }
    }
  }

  // 4. Objection Presence Evaluation
  else if (signal_type === 'objection_presence') {
    const hasOpen = input.objections.has_open === true || (input.objections.open_keys && input.objections.open_keys.length > 0)
    if (operator === 'equals') {
      const expBool = expected_value === true || expected_value === 'true'
      return { matched: hasOpen === expBool, matchedValueDescription: String(hasOpen) }
    } else if (operator === 'exists') {
      return { matched: hasOpen, matchedValueDescription: String(hasOpen) }
    } else if (operator === 'not_exists') {
      return { matched: !hasOpen, matchedValueDescription: String(hasOpen) }
    }
  }

  // 5. Objection Key Evaluation
  else if (signal_type === 'objection_key') {
    const openKeys = input.objections.open_keys || []
    const expStr = typeof expected_value === 'string' ? expected_value.trim().toLowerCase() : String(expected_value ?? '')

    if (operator === 'equals' || operator === 'exists') {
      const matched = openKeys.includes(expStr)
      return { matched, matchedValueDescription: expStr }
    } else if (operator === 'not_exists') {
      const matched = !openKeys.includes(expStr)
      return { matched, matchedValueDescription: null }
    } else if (operator === 'in') {
      const arr = Array.isArray(expected_value) ? expected_value.map(v => String(v).trim().toLowerCase()) : []
      const matched = arr.some(k => openKeys.includes(k))
      return { matched, matchedValueDescription: arr.filter(k => openKeys.includes(k)).join(', ') }
    }
  }

  // 6. Engagement Metric Evaluation
  else if (signal_type === 'engagement_metric') {
    let metricVal = 0
    if (field_key === 'active_interests_count') metricVal = input.engagement.active_interests_count
    else if (field_key === 'open_objections_count') metricVal = input.engagement.open_objections_count

    const expNum = typeof expected_value === 'number' ? expected_value : Number(expected_value ?? 0)
    let matched = false
    if (operator === 'gt') matched = metricVal > expNum
    else if (operator === 'gte') matched = metricVal >= expNum
    else if (operator === 'lt') matched = metricVal < expNum
    else if (operator === 'lte') matched = metricVal <= expNum
    else if (operator === 'equals') matched = metricVal === expNum

    return { matched, matchedValueDescription: String(metricVal) }
  }

  return { matched: false, matchedValueDescription: null }
}

// ============================================================
// Pure Calculation Engine: calculateLeadScore
// ============================================================

export function calculateLeadScore(
  snapshot: LeadScoringSnapshot,
  input: CanonicalLeadScoringInput,
  revisionId: string,
  snapshotHash: string
): ScoringCalculationResult {
  let rawScore = snapshot.base_score
  const contributions: LeadScoreContribution[] = []
  const matchedRuleKeys: string[] = []

  // Ensure deterministic execution: iterate through snapshot rules in canonical order
  for (const rule of snapshot.rules) {
    const { matched, matchedValueDescription } = evaluateRuleMatch(rule, input)
    if (matched) {
      rawScore += rule.points
      matchedRuleKeys.push(rule.rule_key)
      contributions.push({
        rule_key: rule.rule_key,
        label: rule.label,
        signal_type: rule.signal_type,
        field_key: rule.field_key,
        matched_value: matchedValueDescription,
        points: rule.points,
      })
    }
  }

  // Clamp within snapshot limits [min_score, max_score]
  const finalScore = Math.max(snapshot.min_score, Math.min(snapshot.max_score, rawScore))

  // Deterministic Fingerprint
  const inputFingerprint = computeScoringInputFingerprint(revisionId, snapshotHash, input)

  return {
    raw_score: rawScore,
    final_score: finalScore,
    breakdown: {
      base_score: snapshot.base_score,
      raw_score: rawScore,
      final_score: finalScore,
      min_score: snapshot.min_score,
      max_score: snapshot.max_score,
      contributions,
    },
    matched_rule_keys: matchedRuleKeys,
    input_fingerprint: inputFingerprint,
  }
}
