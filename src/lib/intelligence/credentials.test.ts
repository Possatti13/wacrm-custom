import { describe, it, expect, vi } from 'vitest'
import {
  loadIntelligenceCredential,
  ProviderCredentialMismatchError,
  MissingAiCredentialError,
} from './credentials'

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (val: string) => `decrypted-${val}`,
}))

describe('Intelligence Credentials Loader', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'

  it('returns mock key for mock provider without querying db', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = {} as any
    const res = await loadIntelligenceCredential(mockDb, accountId, 'mock')
    expect(res.apiKey).toBe('mock-key')
    expect(res.provider).toBe('mock')
  })

  it('successfully loads and decrypts key when provider matches', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { provider: 'openai', api_key: 'enc-secret' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = { from: fromMock } as any

    const res = await loadIntelligenceCredential(mockDb, accountId, 'openai')
    expect(res.apiKey).toBe('decrypted-enc-secret')
    expect(res.provider).toBe('openai')
  })

  it('throws ProviderCredentialMismatchError when stored provider does not match expected', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { provider: 'anthropic', api_key: 'enc-secret' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = { from: fromMock } as any

    await expect(
      loadIntelligenceCredential(mockDb, accountId, 'openai')
    ).rejects.toThrow(ProviderCredentialMismatchError)
  })

  it('throws MissingAiCredentialError when no row or api_key exists', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockDb = { from: fromMock } as any

    await expect(
      loadIntelligenceCredential(mockDb, accountId, 'openai')
    ).rejects.toThrow(MissingAiCredentialError)
  })
})
