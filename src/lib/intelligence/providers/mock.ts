import type {
  CommercialIntelligenceProvider,
  ExtractionProviderRequest,
  ExtractionProviderResult,
} from '../types'

export class MockStructuredExtractor implements CommercialIntelligenceProvider {
  readonly providerName = 'mock'

  constructor(
    private readonly mockResponse?: unknown,
    private readonly shouldFail = false
  ) {}

  async extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResult> {
    if (this.shouldFail) {
      throw new Error('Mock extraction provider failure')
    }

    const defaultOutput = {
      observations: [
        {
          type: 'interest',
          value: 'scooter',
          catalog_term: 'X-13',
          confidence: 0.95,
          evidence: [{ message_ref: 'M1', quoted_text: 'scooter X-13' }],
        },
        {
          type: 'objection',
          value: 'preço alto',
          confidence: 0.9,
          evidence: [{ message_ref: 'M1', quoted_text: 'preço alto' }],
        },
      ],
    }

    return {
      rawOutput: this.mockResponse !== undefined ? this.mockResponse : defaultOutput,
      usage: {
        promptTokens: 250,
        completionTokens: 80,
        totalTokens: 330,
      },
      model: request.model || 'mock-model-v1',
      provider: 'mock',
      latencyMs: 15,
    }
  }
}
