import { describe, it, expect, vi } from 'vitest'
import { handleScoringJob, type ScoringJobMessage } from './worker'

describe('Lead Scoring Worker', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'
  const contactId = '22222222-2222-2222-2222-222222222222'

  it('handles scoring.recalculate_contact job', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: { outcome: 'applied', contact_id: contactId, score: 80 },
      error: null,
    })

    const mockDb = { rpc: rpcMock } as unknown as Parameters<typeof handleScoringJob>[0]

    const job: ScoringJobMessage = {
      type: 'scoring.recalculate_contact',
      accountId,
      payload: {
        accountId,
        contactId,
        triggerSource: 'pgmq_job',
      },
    }

    const res = await handleScoringJob(mockDb, job)
    expect(res.success).toBe(true)
  })

  it('throws for unknown job type', async () => {
    const mockDb = {} as unknown as Parameters<typeof handleScoringJob>[0]
    const job = {
      type: 'unknown.job',
      accountId,
      payload: {},
    } as unknown as ScoringJobMessage

    await expect(handleScoringJob(mockDb, job)).rejects.toThrow('Unknown scoring job type')
  })
})
