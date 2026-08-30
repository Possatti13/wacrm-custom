import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  normalizeUsage,
  toNetworkError,
  type ProviderArgs,
} from './shared'

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

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  promptFeedback?: GeminiPromptFeedback
  usageMetadata?: GeminiUsageMetadata
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

/**
 * Normalizes HTTP and provider errors from the Google Gemini Developer API.
 */
async function geminiHttpError(res: Response): Promise<AiError> {
  let detail = ''
  let apiStatus = ''
  try {
    const body = (await res.json()) as GeminiResponse
    detail = body?.error?.message || ''
    apiStatus = body?.error?.status || ''
  } catch {
    // Non-JSON error body
  }

  const { status } = res
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

/**
 * Call Google Gemini Developer API with the caller's own API key.
 * Returns the raw assistant text + token usage.
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  const targetModel = model || 'gemini-1.5-flash'
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent`

  // Format contents for Gemini (roles: 'user' | 'model')
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const bodyPayload: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  }

  if (systemPrompt && systemPrompt.trim()) {
    bodyPayload.systemInstruction = {
      parts: [{ text: systemPrompt }],
    }
  }

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await geminiHttpError(res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null

  // Safety & Block checks
  if (data?.promptFeedback?.blockReason) {
    throw new AiError(
      `Google Gemini blocked prompt due to safety policy (${data.promptFeedback.blockReason})`,
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
      `Google Gemini generation blocked by safety policy (${candidate.finishReason})`,
      { code: 'safety_blocked', status: 400 }
    )
  }

  const text = candidate?.content?.parts?.[0]?.text
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Google Gemini returned an empty response.', {
      code: 'empty_response',
      status: 502,
    })
  }

  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
  })

  return { text, usage }
}
