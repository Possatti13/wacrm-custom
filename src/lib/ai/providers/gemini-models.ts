// ============================================================
// Google Gemini Canonical Model Catalog & Dynamic Discovery
// ============================================================

export interface GeminiModelInfo {
  id: string
  displayName: string
  description?: string
  badge?: string
  isRecommended?: boolean
  isDefault?: boolean
  inputCostPerM?: number
  outputCostPerM?: number
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

/**
 * Fallback list of modern canonical Gemini models for commercial intelligence.
 * Obsolete (1.0, 1.5, 2.0) and non-text (image, TTS, embedding, robotics) models are excluded.
 */
export const GEMINI_FALLBACK_MODELS: GeminiModelInfo[] = [
  {
    id: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash-Lite',
    description: 'Alta velocidade e eficiência para extração comercial e alto volume',
    badge: 'Recomendado para custo/volume',
    isRecommended: true,
    isDefault: true,
    inputCostPerM: 0.075,
    outputCostPerM: 0.30,
  },
  {
    id: 'gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash',
    description: 'Mais recente e capaz da família Flash com raciocínio híbrido avançado',
    badge: 'Mais capaz / atual',
    isRecommended: false,
    isDefault: false,
    inputCostPerM: 0.15,
    outputCostPerM: 0.60,
  },
  {
    id: 'gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash',
    description: 'Modelo de alta performance para tarefas textuais',
    badge: undefined,
    isRecommended: false,
    isDefault: false,
    inputCostPerM: 0.12,
    outputCostPerM: 0.50,
  },
  {
    id: 'gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    description: 'Equilíbrio ideal entre inteligência e tempo de resposta',
    badge: undefined,
    isRecommended: false,
    isDefault: false,
    inputCostPerM: 0.10,
    outputCostPerM: 0.40,
  },
  {
    id: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite',
    description: 'Versão leve e econômica da geração 3.1',
    badge: undefined,
    isRecommended: false,
    isDefault: false,
    inputCostPerM: 0.06,
    outputCostPerM: 0.25,
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    description: 'Modelo estável de alta velocidade',
    badge: 'Estável',
    isRecommended: false,
    isDefault: false,
    inputCostPerM: 0.08,
    outputCostPerM: 0.32,
  },
  {
    id: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash-Lite',
    description: 'Versão compacta e estável',
    badge: 'Estável',
    isRecommended: false,
    isDefault: false,
    inputCostPerM: 0.05,
    outputCostPerM: 0.20,
  },
  {
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    description: 'Alta capacidade analítica para raciocínios complexos',
    badge: 'Estável',
    isRecommended: false,
    isDefault: false,
    inputCostPerM: 1.25,
    outputCostPerM: 5.00,
  },
]

/**
 * Filter out non-commercial or obsolete models.
 */
export function isCompatibleGeminiModel(modelId: string, supportedMethods?: string[]): boolean {
  const cleanId = modelId.toLowerCase().replace(/^models\//, '')

  // Exclude obsolete generations (1.0, 1.5, 2.0)
  if (
    cleanId.startsWith('gemini-1.') ||
    cleanId.startsWith('gemini-1-') ||
    cleanId.startsWith('gemini-2.0') ||
    cleanId.startsWith('gemini-2-0') ||
    cleanId.startsWith('gemini-pro-vision') ||
    cleanId.startsWith('gemini-ultra')
  ) {
    return false
  }

  // Exclude non-text, embedding, audio, image-generation, live-only, robotics
  if (
    cleanId.includes('embed') ||
    cleanId.includes('imagen') ||
    cleanId.includes('tts') ||
    cleanId.includes('audio') ||
    cleanId.includes('whisper') ||
    cleanId.includes('chirp') ||
    cleanId.includes('aqa') ||
    cleanId.includes('robotics') ||
    cleanId.includes('learnlm') ||
    cleanId.includes('medlm') ||
    cleanId.includes('realtime') ||
    cleanId.includes('live')
  ) {
    return false
  }

  // Check supportedGenerationMethods if provided
  if (supportedMethods && !supportedMethods.includes('generateContent')) {
    return false
  }

  // Must be a gemini model
  return cleanId.startsWith('gemini-')
}

interface RawGeminiApiModel {
  name: string
  displayName?: string
  description?: string
  supportedGenerationMethods?: string[]
}

/**
 * Dynamically discovers and filters compatible Gemini models using the tenant API key.
 * Falls back to the canonical catalog if the key is missing or the network call fails.
 */
export async function discoverGeminiModels(
  apiKey?: string | null,
  timeoutMs = 8000
): Promise<GeminiModelInfo[]> {
  if (!apiKey || !apiKey.trim()) {
    return GEMINI_FALLBACK_MODELS
  }

  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {
        'x-goog-api-key': apiKey.trim(),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      return GEMINI_FALLBACK_MODELS
    }

    const data = (await res.json()) as { models?: RawGeminiApiModel[] }
    if (!data.models || !Array.isArray(data.models) || data.models.length === 0) {
      return GEMINI_FALLBACK_MODELS
    }

    const fallbackMap = new Map(GEMINI_FALLBACK_MODELS.map((m) => [m.id, m]))
    const discovered: GeminiModelInfo[] = []

    for (const m of data.models) {
      const cleanId = (m.name || '').replace(/^models\//, '').trim()
      if (!isCompatibleGeminiModel(cleanId, m.supportedGenerationMethods)) {
        continue
      }

      const known = fallbackMap.get(cleanId)
      if (known) {
        discovered.push(known)
      } else {
        discovered.push({
          id: cleanId,
          displayName: m.displayName || cleanId,
          description: m.description,
          badge: undefined,
          isRecommended: false,
          isDefault: cleanId === DEFAULT_GEMINI_MODEL,
        })
      }
    }

    if (discovered.length === 0) {
      return GEMINI_FALLBACK_MODELS
    }

    // Sort: Preferred known order first, then other discovered models alphabetically
    const orderIndex = new Map(GEMINI_FALLBACK_MODELS.map((m, idx) => [m.id, idx]))
    discovered.sort((a, b) => {
      const idxA = orderIndex.has(a.id) ? orderIndex.get(a.id)! : 999
      const idxB = orderIndex.has(b.id) ? orderIndex.get(b.id)! : 999
      if (idxA !== idxB) return idxA - idxB
      return a.id.localeCompare(b.id)
    })

    return discovered
  } catch {
    return GEMINI_FALLBACK_MODELS
  }
}
