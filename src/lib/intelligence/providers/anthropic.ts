import type {
  CommercialIntelligenceProvider,
  ExtractionProviderRequest,
  ExtractionProviderResult,
} from '../types'
import { toNetworkError, providerHttpError, normalizeUsage } from '@/lib/ai/providers/shared'

export class AnthropicStructuredExtractor implements CommercialIntelligenceProvider {
  readonly providerName = 'anthropic'

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('AnthropicStructuredExtractor requires an API key')
  }

  async extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResult> {
    const startTime = Date.now()
    const model = request.model || 'claude-3-5-haiku-20241022'
    const timeoutMs = request.timeoutMs || 30000

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          temperature: request.temperature ?? 0.1,
          system: request.systemPrompt,
          messages: [
            {
              role: 'user',
              content: `${request.userPrompt}\n\nRespond with valid JSON only in the format: {"observations": [...]}. Do not include markdown fences.`,
            },
          ],
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw await providerHttpError('Anthropic', res)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()
      const contentStr = data.content?.[0]?.text || '{}'
      const jsonMatch = contentStr.replace(/```json/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(jsonMatch)

      const usage = normalizeUsage({
        prompt: data.usage?.input_tokens,
        completion: data.usage?.output_tokens,
      })

      return {
        rawOutput: parsed,
        usage: usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens } : undefined,
        model,
        provider: 'anthropic',
        latencyMs: Date.now() - startTime,
      }
    } catch (err) {
      throw toNetworkError(err)
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
