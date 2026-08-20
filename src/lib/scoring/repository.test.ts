import { describe, it, expect, vi } from 'vitest'
import {
  saveLeadScoringConfiguration,
  calculateAndPersistContactScore,
} from './repository'

describe('Lead Scoring Repository', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'
  const contactId = '22222222-2222-2222-2222-222222222222'

  it('calls RPC save_lead_scoring_configuration with validated payloads', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        config_id: 'cfg-1',
        revision_id: 'rev-1',
        revision_number: 1,
        snapshot_hash: 'hash-1',
        enabled: true,
      },
      error: null,
    })

    const mockDb = { rpc: rpcMock } as unknown as Parameters<typeof saveLeadScoringConfiguration>[0]

    const res = await saveLeadScoringConfiguration(
      mockDb,
      accountId,
      { enabled: true, base_score: 10, min_score: 0, max_score: 100 },
      [
        {
          rule_key: 'test_rule',
          label: 'Test Rule',
          signal_type: 'profile_field',
          field_key: 'current_intent',
          operator: 'equals',
          expected_value: 'purchase',
          points: 25,
        },
      ]
    )

    expect(rpcMock).toHaveBeenCalledWith('save_lead_scoring_configuration', expect.objectContaining({
      p_account_id: accountId,
      p_config: {
        enabled: true,
        base_score: 10,
        min_score: 0,
        max_score: 100,
      },
    }))
    expect(res.revision_number).toBe(1)
  })

  it('calls RPC calculate_and_persist_contact_score', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        outcome: 'applied',
        contact_id: contactId,
        score: 75,
        scoring_revision_number: 1,
      },
      error: null,
    })

    const mockDb = { rpc: rpcMock } as unknown as Parameters<typeof calculateAndPersistContactScore>[0]

    const res = await calculateAndPersistContactScore(mockDb, accountId, contactId, 'test_trigger')

    expect(rpcMock).toHaveBeenCalledWith('calculate_and_persist_contact_score', {
      p_account_id: accountId,
      p_contact_id: contactId,
      p_trigger_source: 'test_trigger',
    })
    expect(res.score).toBe(75)
  })
})
