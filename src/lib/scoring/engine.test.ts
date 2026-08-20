import { describe, it, expect } from 'vitest'
import {
  calculateLeadScore,
  computeScoringInputFingerprint,
} from './engine'
import type { LeadScoringSnapshot, CanonicalLeadScoringInput } from './types'

describe('Lead Scoring Engine (Pure Function)', () => {
  const baseSnapshot: LeadScoringSnapshot = {
    account_id: '11111111-1111-1111-1111-111111111111',
    revision_number: 1,
    enabled: true,
    base_score: 10,
    min_score: 0,
    max_score: 100,
    rules: [
      {
        rule_key: 'purchase_intent',
        label: 'Purchase Intent',
        signal_type: 'profile_field',
        field_key: 'current_intent',
        operator: 'equals',
        expected_value: 'purchase',
        points: 30,
        sort_order: 1,
      },
      {
        rule_key: 'high_urgency',
        label: 'High Urgency',
        signal_type: 'profile_field',
        field_key: 'urgency',
        operator: 'equals',
        expected_value: 'high',
        points: 20,
        sort_order: 2,
      },
      {
        rule_key: 'budget_attribute',
        label: 'High Budget',
        signal_type: 'attribute',
        field_key: 'budget',
        operator: 'gte',
        expected_value: 50000,
        points: 15,
        sort_order: 3,
      },
      {
        rule_key: 'price_objection',
        label: 'Price Objection Present',
        signal_type: 'objection_presence',
        field_key: null,
        operator: 'equals',
        expected_value: true,
        points: -10,
        sort_order: 4,
      },
      {
        rule_key: 'active_interests_metric',
        label: 'Multiple Interests',
        signal_type: 'engagement_metric',
        field_key: 'active_interests_count',
        operator: 'gte',
        expected_value: 2,
        points: 10,
        sort_order: 5,
      },
    ],
  }

  const baseInput: CanonicalLeadScoringInput = {
    profile: {
      current_intent: 'purchase',
      urgency: 'high',
      sentiment: 'positive',
      next_action: null,
      attributes: {
        budget: 60000,
        payment_preference: 'financing',
      },
    },
    interests: {
      active_item_ids: ['item-1', 'item-2'],
    },
    objections: {
      open_keys: ['preco_alto'],
      has_open: true,
    },
    engagement: {
      active_interests_count: 2,
      open_objections_count: 1,
    },
  }

  it('calculates deterministic score with contributions breakdown', () => {
    const res = calculateLeadScore(baseSnapshot, baseInput, 'rev-1', 'hash-1')

    // Calculation: 10 (base) + 30 (purchase) + 20 (high urgency) + 15 (budget >= 50000) - 10 (objection) + 10 (interests >= 2) = 75
    expect(res.raw_score).toBe(75)
    expect(res.final_score).toBe(75)
    expect(res.matched_rule_keys).toEqual([
      'purchase_intent',
      'high_urgency',
      'budget_attribute',
      'price_objection',
      'active_interests_metric',
    ])
    expect(res.breakdown.contributions).toHaveLength(5)
  })

  it('clamps score within min_score and max_score', () => {
    const highSnapshot: LeadScoringSnapshot = {
      ...baseSnapshot,
      rules: [
        {
          rule_key: 'huge_bonus',
          label: 'Huge Bonus',
          signal_type: 'profile_field',
          field_key: 'current_intent',
          operator: 'equals',
          expected_value: 'purchase',
          points: 150,
          sort_order: 1,
        },
      ],
    }

    const resHigh = calculateLeadScore(highSnapshot, baseInput, 'rev-1', 'hash-1')
    expect(resHigh.raw_score).toBe(160)
    expect(resHigh.final_score).toBe(100) // Clamped to max_score 100

    const lowSnapshot: LeadScoringSnapshot = {
      ...baseSnapshot,
      base_score: 0,
      rules: [
        {
          rule_key: 'huge_penalty',
          label: 'Huge Penalty',
          signal_type: 'objection_presence',
          field_key: null,
          operator: 'equals',
          expected_value: true,
          points: -50,
          sort_order: 1,
        },
      ],
    }

    const resLow = calculateLeadScore(lowSnapshot, baseInput, 'rev-1', 'hash-1')
    expect(resLow.raw_score).toBe(-50)
    expect(resLow.final_score).toBe(0) // Clamped to min_score 0
  })

  it('produces identical canonical fingerprint regardless of object key ordering', () => {
    const inputA: CanonicalLeadScoringInput = {
      profile: {
        current_intent: 'purchase',
        urgency: 'high',
        sentiment: 'neutral',
        next_action: null,
        attributes: { a: 1, b: 2 },
      },
      interests: { active_item_ids: ['x', 'y'] },
      objections: { open_keys: ['obj-1'], has_open: true },
      engagement: { active_interests_count: 2, open_objections_count: 1 },
    }

    const inputB: CanonicalLeadScoringInput = {
      engagement: { open_objections_count: 1, active_interests_count: 2 },
      objections: { has_open: true, open_keys: ['obj-1'] },
      interests: { active_item_ids: ['x', 'y'] },
      profile: {
        attributes: { b: 2, a: 1 },
        next_action: null,
        sentiment: 'neutral',
        urgency: 'high',
        current_intent: 'purchase',
      },
    }

    const hashA = computeScoringInputFingerprint('rev-1', 'hash-1', inputA)
    const hashB = computeScoringInputFingerprint('rev-1', 'hash-1', inputB)

    expect(hashA).toBe(hashB)
  })

  it('distinguishes fingerprints when revisionId changes even if snapshot hash is identical', () => {
    const fp1 = computeScoringInputFingerprint('rev-1', 'same-hash', baseInput)
    const fp2 = computeScoringInputFingerprint('rev-2', 'same-hash', baseInput)

    expect(fp1).not.toBe(fp2)
  })
})
