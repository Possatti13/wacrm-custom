import { describe, it, expect, vi } from 'vitest'
import {
  getTenantIntelligenceSettings,
  saveTenantIntelligenceSettings,
} from './settings'

describe('Tenant Intelligence Settings', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'

  it('fetches settings for account', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        account_id: accountId,
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = { from: fromMock } as any

    const res = await getTenantIntelligenceSettings(mockDb, accountId)
    expect(res?.enabled).toBe(true)
    expect(res?.model).toBe('gpt-4o-mini')
  })

  it('saves settings via RPC', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        account_id: accountId,
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
      error: null,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = { rpc: rpcMock } as any

    const res = await saveTenantIntelligenceSettings(mockDb, accountId, {
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
    })

    expect(rpcMock).toHaveBeenCalledWith('save_tenant_intelligence_settings', {
      p_account_id: accountId,
      p_settings: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    })
    expect(res.enabled).toBe(true)
  })
})
