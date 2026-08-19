import { describe, it, expect } from 'vitest'
import { computeInsightDedupeKey } from './dedupe'

describe('computeInsightDedupeKey', () => {
  const MSG_1 = '11111111-1111-1111-1111-111111111111'
  const MSG_2 = '22222222-2222-2222-2222-222222222222'

  it('produces deterministic identical key for same semantic and same evidence', () => {
    const key1 = computeInsightDedupeKey({
      insightType: 'interest',
      catalogItemId: '33333333-3333-3333-3333-333333333333',
      evidence: [{ message_id: MSG_1, start_offset: 10, end_offset: 25 }],
      extractorVersion: 'v1',
    })

    const key2 = computeInsightDedupeKey({
      insightType: 'interest',
      catalogItemId: '33333333-3333-3333-3333-333333333333',
      evidence: [{ message_id: MSG_1, start_offset: 10, end_offset: 25 }],
      extractorVersion: 'v1',
    })

    expect(key1).toBe(key2)
  })

  it('produces identical key regardless of evidence array ordering', () => {
    const key1 = computeInsightDedupeKey({
      insightType: 'objection',
      valueText: 'preco alto',
      evidence: [
        { message_id: MSG_1, start_offset: 0, end_offset: 10 },
        { message_id: MSG_2, start_offset: 5, end_offset: 15 },
      ],
    })

    const key2 = computeInsightDedupeKey({
      insightType: 'objection',
      valueText: 'preco alto',
      evidence: [
        { message_id: MSG_2, start_offset: 5, end_offset: 15 },
        { message_id: MSG_1, start_offset: 0, end_offset: 10 },
      ],
    })

    expect(key1).toBe(key2)
  })

  it('produces different key for same semantic value on different message', () => {
    const key1 = computeInsightDedupeKey({
      insightType: 'objection',
      valueText: 'preco alto',
      evidence: [{ message_id: MSG_1, start_offset: 0, end_offset: 10 }],
    })

    const key2 = computeInsightDedupeKey({
      insightType: 'objection',
      valueText: 'preco alto',
      evidence: [{ message_id: MSG_2, start_offset: 0, end_offset: 10 }],
    })

    expect(key1).not.toBe(key2)
  })

  it('produces different key for different extractor version', () => {
    const keyV1 = computeInsightDedupeKey({
      insightType: 'intent',
      valueText: 'compra',
      evidence: [{ message_id: MSG_1 }],
      extractorVersion: 'v1',
    })

    const keyV2 = computeInsightDedupeKey({
      insightType: 'intent',
      valueText: 'compra',
      evidence: [{ message_id: MSG_1 }],
      extractorVersion: 'v2',
    })

    expect(keyV1).not.toBe(keyV2)
  })
})
