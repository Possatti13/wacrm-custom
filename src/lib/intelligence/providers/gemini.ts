import type {
  CommercialIntelligenceProvider,
  ExtractionProviderRequest,
  ExtractionProviderResult,
} from '../types'
import { toNetworkError, normalizeUsage } from '@/lib/ai/providers/shared'
import { AiError } from '@/lib/ai/types'
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/providers/gemini-models'

interface GeminiPart {
  text?: string
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[]
    role?: string
  }
  finishReason?: string
}

interface GeminiPromptFeedback {
  blockReason?: string
  blockReasonMessage?: string
}

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

interface GeminiExtractionResponse {
  candidates?: GeminiCandidate[]
  promptFeedback?: GeminiPromptFeedback
  usageMetadata?: GeminiUsageMetadata
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

async function geminiExtractionHttpError(res: Response): Promise<AiError> {
  let detail = ''
  let apiStatus = ''
  try {
    const body = (await res.json()) as GeminiExtractionResponse
    detail = body?.error?.message || ''
    apiStatus = body?.error?.status || ''
  } catch {
    // Non-JSON error body
  }

  const { status } = res

  const isModelNotFound =
    status === 404 ||
    apiStatus === 'NOT_FOUND' ||
    /models\/|not found|is not found/i.test(detail)

  if (isModelNotFound) {
    return new AiError(
      'Modelo indisponível. Selecione outro modelo Gemini.',
      {
        code: 'model_not_found',
        status: 404,
      }
    )
  }

  const isKeyError =
    status === 401 ||
    status === 403 ||
    apiStatus === 'UNAUTHENTICATED' ||
    apiStatus === 'PERMISSION_DENIED' ||
    /api\s*key/i.test(detail)

  const isRateLimit = status === 429 || apiStatus === 'RESOURCE_EXHAUSTED'

  const code = isKeyError
    ? 'invalid_key'
    : isRateLimit
      ? 'rate_limited'
      : 'provider_error'

  const base =
    code === 'invalid_key'
      ? 'Google Gemini rejected the API key'
      : code === 'rate_limited'
        ? 'Google Gemini rate limit reached'
        : `Google Gemini API error (${status})`

  return new AiError(detail ? `${base}: ${detail}` : base, {
    code,
    status: code === 'invalid_key' ? 401 : status === 429 ? 429 : 502,
  })
}

export class GeminiStructuredExtractor implements CommercialIntelligenceProvider {
  readonly providerName = 'gemini'

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('GeminiStructuredExtractor requires an API key')
  }

  async extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResult> {
    const startTime = Date.now()
    const model = request.model || DEFAULT_GEMINI_MODEL
    const timeoutMs = request.timeoutMs || 30000

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const bodyPayload: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: request.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: request.temperature ?? 0.1,
        responseMimeType: 'application/json',
      },
    }

    if (request.systemPrompt && request.systemPrompt.trim()) {
      bodyPayload.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      }
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw await geminiExtractionHttpError(res)
      }

      const data = (await res.json().catch(() => null)) as GeminiExtractionResponse | null

      // Safety & Policy blocks
      if (data?.promptFeedback?.blockReason) {
        throw new AiError(
          `Google Gemini blocked extraction prompt due to safety policy (${data.promptFeedback.blockReason})`,
          { code: 'safety_blocked', status: 400 }
        )
      }

      const candidate = data?.candidates?.[0]
      if (
        candidate?.finishReason &&
        ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(
          candidate.finishReason
        )
      ) {
        throw new AiError(
          `Google Gemini extraction blocked by safety policy (${candidate.finishReason})`,
          { code: 'safety_blocked', status: 400 }
        )
      }

      const rawContent = candidate?.content?.parts?.[0]?.text || '{}'
      // Strip any residual code fences just in case
      const cleanJsonStr = rawContent.replace(/```json/g, '').replace(/```/g, '').trim()
      let parsed: unknown
      try {
        parsed = JSON.parse(cleanJsonStr)
      } catch {
        throw new AiError(`Google Gemini returned invalid JSON: ${cleanJsonStr.slice(0, 100)}`, {
          code: 'invalid_json',
          status: 502,
        })
      }

      const usage = normalizeUsage({
        prompt: data?.usageMetadata?.promptTokenCount,
        completion: data?.usageMetadata?.candidatesTokenCount,
        total: data?.usageMetadata?.totalTokenCount,
      })

      return {
        rawOutput: parsed,
        usage: usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            }
          : undefined,
        model,
        provider: 'gemini',
        latencyMs: Date.now() - startTime,
      }
    } catch (err) {
      throw toNetworkError(err)
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
