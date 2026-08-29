import { describe, it, expect, vi } from 'vitest'
import {
  processIntelligenceBatch,
  resolveProviderForTenant,
} from './intelligence-worker'
import { MockStructuredExtractor } from '@/lib/intelligence/providers/mock'

describe('Intelligence Worker', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'
  const conversationId = '22222222-2222-2222-2222-222222222222'

  it('resolves provider correctly for mock and openai', () => {
    const mockP = resolveProviderForTenant('mock')
    expect(mockP.providerName).toBe('mock')

    const openaiP = resolveProviderForTenant('openai', 'sk-test')
    expect(openaiP.providerName).toBe('openai')

    expect(() => resolveProviderForTenant('openai', '')).toThrow('Missing OpenAI API key')
  })

  it('processes batch from PGMQ and archives on success', async () => {
    const rpcMock = vi.fn().mockImplementation((name: string) => {
      if (name === 'read_intelligence_extraction') {
        return Promise.resolve({
          data: [
            {
              msg_id: 101,
              read_ct: 1,
              message: {
                accountId,
                payload: {
                  accountId,
                  conversationId,
                  provider: 'mock',
                },
              },
            },
          ],
          error: null,
        })
      }
      if (name === 'claim_conversation_analysis_run') {
        return Promise.resolve({
          data: { status: 'no_messages', run_id: null },
          error: null,
        })
      }
      if (name === 'archive_intelligence_extraction') {
        return Promise.resolve({ data: true, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = {
      rpc: rpcMock,
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            gte: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    } as any

    const stats = await processIntelligenceBatch({
      db: mockDb,
      providerOverride: new MockStructuredExtractor(),
    })

    expect(stats.read).toBe(1)
    expect(stats.succeeded).toBe(1)
    expect(stats.failed).toBe(0)
    expect(rpcMock).toHaveBeenCalledWith('archive_intelligence_extraction', { p_msg_id: 101 })
  })

  it('routes to DLQ when read_ct exceeds MAX_JOB_ATTEMPTS', async () => {
    const rpcMock = vi.fn().mockImplementation((name: string) => {
      if (name === 'read_intelligence_extraction') {
        return Promise.resolve({
          data: [
            {
              msg_id: 102,
              read_ct: 3,
              message: {
                accountId,
                payload: {
                  accountId,
                  conversationId,
                  provider: 'mock',
                },
              },
            },
          ],
          error: null,
        })
      }
      if (name === 'claim_conversation_analysis_run') {
        return Promise.resolve({
          data: { status: 'claimed', run_id: 'run-1' },
          error: null,
        })
      }
      if (name === 'build_conversation_analysis_input') {
        return Promise.reject(new Error('Fatal database error'))
      }
      if (name === 'dead_letter_intelligence_extraction') {
        return Promise.resolve({ data: true, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = { rpc: rpcMock } as any

    const stats = await processIntelligenceBatch({
      db: mockDb,
      providerOverride: new MockStructuredExtractor(),
    })

    expect(stats.read).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.deadLettered).toBe(1)
    expect(rpcMock).toHaveBeenCalledWith('dead_letter_intelligence_extraction', expect.objectContaining({
      p_msg_id: 102,
    }))
  })
})
