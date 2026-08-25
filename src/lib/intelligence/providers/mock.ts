import type {
  CommercialIntelligenceProvider,
  ExtractionProviderRequest,
  ExtractionProviderResult,
} from '../types';

let globalMockCallCount = 0;

export function getMockProviderCallCount(): number {
  return globalMockCallCount;
}

export function resetMockProviderCallCount(): void {
  globalMockCallCount = 0;
}

export class MockStructuredExtractor implements CommercialIntelligenceProvider {
  readonly providerName = 'mock';

  constructor(
    private readonly mockResponse?: unknown,
    private readonly shouldFail = false,
    private readonly latencyMs = 15
  ) {}

  async extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResult> {
    globalMockCallCount++;

    if (this.shouldFail) {
      throw new Error('Mock extraction provider failure');
    }

    const defaultOutput = {
      summary: 'Cliente demonstrou interesse no produto e solicitou informações de entrega.',
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
        {
          type: 'intent',
          value: 'purchase',
          confidence: 0.92,
          evidence: [{ message_ref: 'M1', quoted_text: 'quero comprar' }],
        },
        {
          type: 'urgency',
          value: 'high',
          confidence: 0.88,
          evidence: [{ message_ref: 'M1', quoted_text: 'esta semana' }],
        },
      ],
      next_recommended_action: 'Enviar proposta formal com opções de parcelamento sem juros.',
    };

    return {
      rawOutput: this.mockResponse !== undefined ? this.mockResponse : defaultOutput,
      usage: {
        promptTokens: 250,
        completionTokens: 80,
        totalTokens: 330,
      },
      model: request.model || 'mock-model-v1',
      provider: 'mock',
      latencyMs: this.latencyMs,
    };
  }
}
