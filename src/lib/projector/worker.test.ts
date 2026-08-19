import { describe, it, expect, vi } from 'vitest'
import { handleProjectCommercialStateJob } from './worker'

describe('Commercial State Projector Worker', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'
  const contactId = '22222222-2222-2222-2222-222222222222'

  it('processes project job and returns success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb: any = {
      rpc: vi.fn().mockResolvedValue({
        data: { outcome: 'applied', projection_run_id: 'run-10' },
        error: null,
      }),
    }

    const res = await handleProjectCommercialStateJob(
      { accountId, contactId, triggerSource: 'analysis_completed' },
      mockDb
    )

    expect(res.success).toBe(true)
    expect(res.outcome).toBe('applied')
    expect(res.projection_run_id).toBe('run-10')
  })

  it('handles database error safely without throwing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb: any = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database deadlock simulated' },
      }),
    }

    const res = await handleProjectCommercialStateJob(
      { accountId, contactId },
      mockDb
    )

    expect(res.success).toBe(false)
    expect(res.error).toContain('Database deadlock simulated')
  })
})
