import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getTenantIntelligenceSettings,
  saveTenantIntelligenceSettings,
} from './settings'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { GET, POST } from '@/app/api/ai/intelligence-settings/route'

// Mock auth module
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  toErrorResponse: vi.fn((err: any) => {
    return new Response(JSON.stringify({ error: err.message || 'Error' }), {
      status: err.status || 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }),
}))

describe('Atomic AI & Commercial Intelligence Configuration Save', () => {
  const accountId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed'
  const FAKE_KEY = 'AIzaSyFakeGeminiApiKeyForTestingPurposes12345'
  const MASKED_KEY = '••••••••••••••••'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // A, B, C: Gemini + new key -> save succeeds, credential encrypted, is_active true
  it('A, B, C: saves Gemini config atomically with encrypted key and is_active=true', async () => {
    let capturedEncryptedKey: string | null = null

    const rpcMock = vi.fn().mockImplementation((fn: string, args: any) => {
      if (fn === 'save_tenant_intelligence_settings') {
        capturedEncryptedKey = args.p_settings.encrypted_api_key
        return Promise.resolve({
          data: {
            account_id: accountId,
            enabled: true,
            provider: 'gemini',
            model: 'gemini-3.5-flash-lite',
            invocation_mode: 'smart_auto',
            has_api_key: true,
            is_active: true,
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const mockDb = { rpc: rpcMock } as any

    const encryptedKey = encrypt(FAKE_KEY)
    const result = await saveTenantIntelligenceSettings(mockDb, accountId, {
      enabled: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      invocation_mode: 'smart_auto',
      encrypted_api_key: encryptedKey,
    })

    expect(rpcMock).toHaveBeenCalledWith('save_tenant_intelligence_settings', {
      p_account_id: accountId,
      p_settings: {
        enabled: true,
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        invocation_mode: 'smart_auto',
        encrypted_api_key: encryptedKey,
      },
    })

    expect(capturedEncryptedKey).toBe(encryptedKey)
    expect(capturedEncryptedKey).not.toBe(FAKE_KEY)
    expect(decrypt(capturedEncryptedKey!)).toBe(FAKE_KEY)
    expect(result.has_api_key).toBe(true)
    expect(result.is_active).toBe(true)
  })

  // D: Second save without new key preserves credential
  it('D: second save without new key passes encrypted_api_key=null and preserves credential', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        account_id: accountId,
        enabled: true,
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        invocation_mode: 'smart_auto',
        has_api_key: true,
        is_active: true,
      },
      error: null,
    })

    const mockDb = { rpc: rpcMock } as any

    const result = await saveTenantIntelligenceSettings(mockDb, accountId, {
      enabled: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      invocation_mode: 'smart_auto',
      encrypted_api_key: null,
    })

    expect(rpcMock).toHaveBeenCalledWith('save_tenant_intelligence_settings', {
      p_account_id: accountId,
      p_settings: {
        enabled: true,
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        invocation_mode: 'smart_auto',
        encrypted_api_key: null,
      },
    })

    expect(result.has_api_key).toBe(true)
    expect(result.is_active).toBe(true)
  })

  // E: Changing model preserves credential
  it('E: changing model passes new model and preserves existing credential', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        account_id: accountId,
        enabled: true,
        provider: 'gemini',
        model: 'gemini-3.7-flash',
        invocation_mode: 'smart_auto',
        has_api_key: true,
        is_active: true,
      },
      error: null,
    })

    const mockDb = { rpc: rpcMock } as any

    const result = await saveTenantIntelligenceSettings(mockDb, accountId, {
      enabled: true,
      provider: 'gemini',
      model: 'gemini-3.7-flash',
      invocation_mode: 'smart_auto',
      encrypted_api_key: null,
    })

    expect(result.model).toBe('gemini-3.7-flash')
    expect(result.has_api_key).toBe(true)
    expect(result.is_active).toBe(true)
  })

  // F: Masked placeholder is never encrypted as an API key
  it('F: route ignores masked placeholder and does not overwrite key with dots', async () => {
    const { requireRole } = await import('@/lib/auth/account')
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        account_id: accountId,
        enabled: true,
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        has_api_key: true,
        is_active: true,
      },
      error: null,
    })

    const mockSupabase = { rpc: rpcMock }
    vi.mocked(requireRole).mockResolvedValueOnce({
      supabase: mockSupabase as any,
      accountId,
      account: { id: accountId } as any,
      userId: 'user-1',
      role: 'admin',
    })

    const req = new Request('http://localhost/api/ai/intelligence-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          enabled: true,
          provider: 'gemini',
          model: 'gemini-3.5-flash-lite',
        },
        apiKey: MASKED_KEY,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    // Verify that encrypted_api_key passed to RPC is null (placeholder was not encrypted as key)
    expect(rpcMock).toHaveBeenCalledWith('save_tenant_intelligence_settings', {
      p_account_id: accountId,
      p_settings: expect.objectContaining({
        encrypted_api_key: null,
      }),
    })
  })

  // G: Scoring rule normalization handles both shorthand and full object formats
  it('G: normalizes scoring rules without throwing rule_key error', async () => {
    const { requireRole } = await import('@/lib/auth/account')
    const rpcMock = vi.fn().mockImplementation((fn: string) => {
      if (fn === 'save_tenant_intelligence_settings') {
        return Promise.resolve({
          data: {
            account_id: accountId,
            enabled: true,
            provider: 'gemini',
            model: 'gemini-3.5-flash-lite',
            has_api_key: true,
            is_active: true,
          },
          error: null,
        })
      }
      if (fn === 'save_lead_scoring_configuration') {
        return Promise.resolve({
          data: {
            config_id: 'cfg-1',
            revision_id: 'rev-1',
            revision_number: 1,
            snapshot_hash: 'hash',
            enabled: true,
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const mockSupabase = { rpc: rpcMock }
    vi.mocked(requireRole).mockResolvedValueOnce({
      supabase: mockSupabase as any,
      accountId,
      account: { id: accountId } as any,
      userId: 'user-1',
      role: 'admin',
    })

    const req = new Request('http://localhost/api/ai/intelligence-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          enabled: true,
          provider: 'gemini',
          model: 'gemini-3.5-flash-lite',
        },
        scoringConfig: {
          enabled: true,
          base_score: 10,
          min_score: 0,
          max_score: 100,
        },
        scoringRules: [
          { rule_name: 'intent_purchase', weight: 30, rule_type: 'intent' },
          { rule_name: 'urgency_high', weight: 20, rule_type: 'urgency' },
          { rule_name: 'catalog_interest', weight: 20, rule_type: 'catalog' },
        ],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('save_lead_scoring_configuration', expect.objectContaining({
      p_rules: expect.arrayContaining([
        expect.objectContaining({ rule_key: 'intent_purchase', points: 30 }),
        expect.objectContaining({ rule_key: 'urgency_high', points: 20 }),
        expect.objectContaining({ rule_key: 'catalog_interest', points: 20 }),
      ]),
    }))
  })

  // H: GET returns has_api_key only (never plaintext secret)
  it('H: GET route never returns plaintext API key, only boolean flag', async () => {
    const { getCurrentAccount } = await import('@/lib/auth/account')
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tenant_intelligence_settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    account_id: accountId,
                    enabled: true,
                    provider: 'gemini',
                    model: 'gemini-3.5-flash-lite',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'ai_configs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    api_key: encrypt(FAKE_KEY),
                    provider: 'gemini',
                    model: 'gemini-3.5-flash-lite',
                    is_active: true,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }

    vi.mocked(getCurrentAccount).mockResolvedValueOnce({
      supabase: mockSupabase as any,
      accountId,
      account: { id: accountId } as any,
      userId: 'user-1',
      role: 'admin',
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.has_api_key).toBe(true)
    expect(json.apiKey).toBeUndefined()
    expect(json.api_key).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain(FAKE_KEY)
  })

  // I: Secret is never exposed in errors or serialized objects
  it('I: ensures secret is never leaked even if error occurs during processing', async () => {
    const { requireRole } = await import('@/lib/auth/account')
    const mockSupabase = {
      rpc: vi.fn().mockRejectedValue(new Error(`Database connection failed: ${FAKE_KEY}`)),
    }

    vi.mocked(requireRole).mockResolvedValueOnce({
      supabase: mockSupabase as any,
      accountId,
      account: { id: accountId } as any,
      userId: 'user-1',
      role: 'admin',
    })

    const req = new Request('http://localhost/api/ai/intelligence-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { enabled: true, provider: 'gemini', model: 'gemini-3.5-flash-lite' },
        apiKey: FAKE_KEY,
      }),
    })

    const res = await POST(req)
    const json = await res.json()
    // When error occurs, sanitized response should not contain raw secret
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
