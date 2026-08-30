import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiStructuredExtractor } from './gemini'
import { resolveProviderForTenant } from '@/lib/jobs/workers/intelligence-worker'
import { generateGemini } from '@/lib/ai/providers/gemini'
import { AiError } from '@/lib/ai/types'

describe('Google Gemini Intelligence Provider Adapter', () => {
  const FAKE_API_KEY = 'AIzaSyFakeTestKeyForGeminiIntegration12345'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // A. Provider factory resolves gemini
  it('A. resolves provider correctly in worker factory', () => {
    const geminiP = resolveProviderForTenant('gemini', FAKE_API_KEY)
    expect(geminiP.providerName).toBe('gemini')
    expect(geminiP).toBeInstanceOf(GeminiStructuredExtractor)

    expect(() => resolveProviderForTenant('gemini', '')).toThrow('Missing Google Gemini API key')
  })

  // B. Gemini structured response -> normalized output
  it('B. parses structured extraction output and formats result', async () => {
    const mockResponsePayload = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  summary: 'Cliente demonstrou interesse em Scooter Elétrica mas achou preço alto.',
                  observations: [
                    {
                      type: 'interest',
                      value: 'Scooter Elétrica',
                      catalog_term: 'Scooter Elétrica',
                      confidence: 0.95,
                    },
                    {
                      type: 'objection',
                      value: 'preço alto',
                      taxonomy_code: 'price_budget',
                      confidence: 0.9,
                      evidence: [
                        {
                          message_ref: 'M1',
                          quoted_text: 'achei o preço alto',
                        },
                      ],
                    },
                  ],
                  next_recommended_action: 'Enviar tabela com opção de parcelamento sem juros',
                }),
              },
            ],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 150,
        candidatesTokenCount: 65,
        totalTokenCount: 215,
      },
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponsePayload,
    } as Response)

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    const result = await extractor.extract({
      systemPrompt: 'System commercial prompt',
      userPrompt: 'User conversation text',
      model: 'gemini-1.5-flash',
      temperature: 0.1,
    })

    expect(result.provider).toBe('gemini')
    expect(result.model).toBe('gemini-1.5-flash')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.usage).toEqual({
      promptTokens: 150,
      completionTokens: 65,
      totalTokens: 215,
    })

    const raw = result.rawOutput as any
    expect(raw.summary).toContain('Scooter Elétrica')
    expect(raw.observations).toHaveLength(2)
    expect(raw.observations[1].taxonomy_code).toBe('price_budget')
  })

  // C. Invalid JSON -> rejected
  it('C. throws AiError on invalid JSON returned by Gemini', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'NOT A JSON STRING {{{' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
      }),
    } as Response)

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    await expect(
      extractor.extract({
        systemPrompt: 'sys',
        userPrompt: 'user',
      })
    ).rejects.toThrow(/invalid JSON/i)
  })

  // F. Token telemetry mapping
  it('F. correctly maps prompt, completion and total token counts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"observations": []}' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 300,
          candidatesTokenCount: 120,
          totalTokenCount: 420,
        },
      }),
    } as Response)

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    const result = await extractor.extract({
      systemPrompt: 'sys',
      userPrompt: 'user',
    })

    expect(result.usage?.promptTokens).toBe(300)
    expect(result.usage?.completionTokens).toBe(120)
    expect(result.usage?.totalTokens).toBe(420)
  })

  // G. 401 / Invalid API key error normalization
  it('G. normalizes 400/401 invalid key error to AiError with code invalid_key and status 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
        },
      }),
    } as Response)

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    await expect(
      extractor.extract({
        systemPrompt: 'sys',
        userPrompt: 'user',
      })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof AiError &&
        err.code === 'invalid_key' &&
        err.status === 401 &&
        /Google Gemini rejected the API key/i.test(err.message)
      )
    })
  })

  // H. 429 Rate limit normalization
  it('H. normalizes 429 RESOURCE_EXHAUSTED error to code rate_limited and status 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          code: 429,
          message: 'Quota exceeded for quota metric GenerateContent.',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
    } as Response)

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    await expect(
      extractor.extract({
        systemPrompt: 'sys',
        userPrompt: 'user',
      })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof AiError &&
        err.code === 'rate_limited' &&
        err.status === 429
      )
    })
  })

  // I. Safety blocked response
  it('I. throws safety_blocked AiError when candidate is blocked by safety policy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: 'SAFETY',
            content: { parts: [] },
          },
        ],
      }),
    } as Response)

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    await expect(
      extractor.extract({
        systemPrompt: 'sys',
        userPrompt: 'user',
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AiError && err.code === 'safety_blocked'
    })
  })

  // J. Timeout handling
  it('J. maps fetch abort timeout to timeout AiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => {
      const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      return Promise.reject(error)
    })

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    await expect(
      extractor.extract({
        systemPrompt: 'sys',
        userPrompt: 'user',
        timeoutMs: 10,
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AiError && err.code === 'timeout' && err.status === 504
    })
  })

  // K. Secret is never logged
  it('K. ensures secret is never embedded in error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: {
          code: 500,
          message: 'Internal server error occurred on Google infrastructure',
        },
      }),
    } as Response)

    const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
    try {
      await extractor.extract({
        systemPrompt: 'sys',
        userPrompt: 'user',
      })
      expect.unreachable('Should have thrown error')
    } catch (err: any) {
      expect(err.message).not.toContain(FAKE_API_KEY)
    }
  })

  // Text Completion / Chat / Ping Generation
  describe('generateGemini (Text & Health Check)', () => {
    it('generates reply with usage telemetry and model response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: 'OK' }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 1,
            totalTokenCount: 6,
          },
        }),
      } as Response)

      const res = await generateGemini({
        apiKey: FAKE_API_KEY,
        model: 'gemini-1.5-flash',
        systemPrompt: 'Ping check',
        messages: [{ role: 'user', content: 'ping' }],
        timeoutMs: 5000,
      })

      expect(res.text).toBe('OK')
      expect(res.usage).toEqual({
        promptTokens: 5,
        completionTokens: 1,
        totalTokens: 6,
      })
    })
  })

  // D. Taxonomy fallback & validation
  describe('D & E. Taxonomy mapping and Evidence reference extraction', () => {
    it('validates and maps structured observations from Gemini extractor', async () => {
      const mockPayload = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: 'Cliente acha caro',
                    observations: [
                      {
                        type: 'objection',
                        value: 'preço alto',
                        taxonomy_code: 'unknown_custom_code',
                        confidence: 0.88,
                        evidence: [
                          {
                            message_ref: 'M1',
                            quoted_text: 'valor está muito alto',
                          },
                        ],
                      },
                    ],
                  }),
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
      } as Response)

      const extractor = new GeminiStructuredExtractor(FAKE_API_KEY)
      const res = await extractor.extract({
        systemPrompt: 'System',
        userPrompt: 'User',
      })

      const raw = res.rawOutput as any
      expect(raw.observations[0].taxonomy_code).toBe('unknown_custom_code')
      expect(raw.observations[0].evidence[0].message_ref).toBe('M1')
      expect(raw.observations[0].evidence[0].quoted_text).toBe('valor está muito alto')
    })
  })
})
