import type {
  CommercialIntelligenceProvider,
  ExtractionProviderRequest,
  ExtractionProviderResult,
} from '../types'
import { toNetworkError, providerHttpError, normalizeUsage } from '@/lib/ai/providers/shared'

export class OpenAiStructuredExtractor implements CommercialIntelligenceProvider {
  readonly providerName = 'openai'

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('OpenAiStructuredExtractor requires an API key')
  }

  async extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResult> {
    const startTime = Date.now()
    const model = request.model || 'gpt-4o-mini'
    const timeoutMs = request.timeoutMs || 30000

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: request.temperature ?? 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw await providerHttpError('OpenAI', res)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()
      const contentStr = data.choices?.[0]?.message?.content || '{}'
      const parsed = JSON.parse(contentStr)
      const usage = normalizeUsage({
        prompt: data.usage?.prompt_tokens,
        completion: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      })

      return {
        rawOutput: parsed,
        usage: usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens } : undefined,
        model,
        provider: 'openai',
        latencyMs: Date.now() - startTime,
      }
    } catch (err) {
      throw toNetworkError(err)
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
