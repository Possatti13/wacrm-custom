import { describe, it, expect, vi } from 'vitest'
import { projectContactCommercialState, getContactProvenance } from './repository'

describe('Commercial State Projector Repository', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'
  const contactId = '22222222-2222-2222-2222-222222222222'

  it('calls RPC project_contact_commercial_state with validated UUIDs', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: { outcome: 'applied', projection_run_id: 'run-1', mutations_count: 3 },
      error: null,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb: any = { rpc: rpcMock }

    const res = await projectContactCommercialState(mockDb, {
      accountId,
      contactId,
      triggerSource: 'analysis_completed',
    })

    expect(rpcMock).toHaveBeenCalledWith('project_contact_commercial_state', {
      p_account_id: accountId,
      p_contact_id: contactId,
      p_trigger_source: 'analysis_completed',
    })
    expect(res.outcome).toBe('applied')
    expect(res.mutations_count).toBe(3)
  })

  it('rejects invalid UUIDs before calling RPC', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb: any = { rpc: vi.fn() }

    await expect(
      projectContactCommercialState(mockDb, {
        accountId: 'invalid-uuid',
        contactId,
      })
    ).rejects.toThrow('must be a valid UUID')
  })

  it('queries contact provenance records ordered by created_at', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb: any = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'prov-1',
                    account_id: accountId,
                    contact_id: contactId,
                    source_conversation_id: 'conv-1',
                    source_insight_id: 'ins-1',
                    target_type: 'profile_field',
                    target_key: 'current_intent',
                    created_at: '2026-08-19T10:00:00Z',
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }

    const prov = await getContactProvenance(mockDb, accountId, contactId)
    expect(prov.length).toBe(1)
    expect(prov[0].target_key).toBe('current_intent')
  })
})
