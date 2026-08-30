import type { Fact, ProviderFactPacket, SynthesisOutput } from './types';

export interface ValidationResult {
  valid: boolean;
  sanitizedSynthesis: SynthesisOutput;
  invalidFactIds: string[];
  droppedClaims: Array<{ text: string; reason: string }>;
  droppedRecommendations: Array<{ text: string; reason: string }>;
  warnings: string[];
}

export function validateAndSanitizeSynthesis(
  synthesis: SynthesisOutput,
  factPacket: ProviderFactPacket
): ValidationResult {
  const factMap = new Map<string, Fact>();
  for (const f of factPacket.facts) {
    factMap.set(f.fact_id, f);
  }

  const invalidFactIds: string[] = [];
  const droppedClaims: Array<{ text: string; reason: string }> = [];
  const droppedRecommendations: Array<{ text: string; reason: string }> = [];
  const warnings: string[] = [];

  // 1. Validate Claims (Fact-ID Grounding + Numeric Grounding + Policy Safety)
  const sanitizedClaims: SynthesisOutput['claims'] = [];

  for (const claim of synthesis.claims || []) {
    if (!claim.text || typeof claim.text !== 'string' || !claim.text.trim()) {
      continue;
    }

    // Safety Policy Guard
    if (isPunitiveOrInsultingOutput(claim.text)) {
      droppedClaims.push({
        text: claim.text,
        reason: 'Violation: Punitive recommendation or personal employee judgment is prohibited',
      });
      continue;
    }

    const validIds: string[] = [];
    for (const id of claim.fact_ids || []) {
      if (factMap.has(id)) {
        validIds.push(id);
      } else {
        invalidFactIds.push(id);
      }
    }

    // Fail-closed: If claim has NO valid fact IDs, reject the factual claim
    if (validIds.length === 0) {
      droppedClaims.push({
        text: claim.text,
        reason: 'No valid fact_ids referencing actual facts in fact packet',
      });
      continue;
    }

    // Numeric Grounding Check
    const allowedNumbers = collectAllowedNumbersForFactIds(validIds, factMap);
    const numericValidation = validateClaimNumbers(claim.text, allowedNumbers);

    if (!numericValidation.valid) {
      droppedClaims.push({
        text: claim.text,
        reason: `Unsupported factual numbers in claim: [${numericValidation.unsupportedNumbers.join(', ')}]`,
      });
      continue;
    }

    sanitizedClaims.push({
      text: claim.text.trim(),
      fact_ids: validIds,
      numeric_refs: claim.numeric_refs,
    });
  }

  // 2. Validate Recommendations
  const sanitizedRecommendations: SynthesisOutput['recommendations'] = [];

  for (const rec of synthesis.recommendations || []) {
    if (!rec.text || typeof rec.text !== 'string' || !rec.text.trim()) {
      continue;
    }

    // Safety Policy Guard
    if (isPunitiveOrInsultingOutput(rec.text)) {
      droppedRecommendations.push({
        text: rec.text,
        reason: 'Violation: Punitive recommendation or personal employee judgment is prohibited',
      });
      continue;
    }

    const validIds: string[] = [];
    for (const id of rec.based_on_fact_ids || []) {
      if (factMap.has(id)) {
        validIds.push(id);
      } else {
        invalidFactIds.push(id);
      }
    }

    // If recommendation had fact_ids but all were invalid, reject or strip based on strictness
    if ((rec.based_on_fact_ids || []).length > 0 && validIds.length === 0) {
      droppedRecommendations.push({
        text: rec.text,
        reason: 'Referenced non-existent fact_ids',
      });
      continue;
    }

    sanitizedRecommendations.push({
      text: rec.text.trim(),
      based_on_fact_ids: validIds,
    });
  }

  // 3. Sanitize Answer if it contains punitive sentences
  let sanitizedAnswer = synthesis.answer || '';
  if (isPunitiveOrInsultingOutput(sanitizedAnswer)) {
    const sentences = sanitizedAnswer.split(/(?<=[.!?])\s+/);
    const safeSentences = sentences.filter((s) => !isPunitiveOrInsultingOutput(s));
    sanitizedAnswer = safeSentences.join(' ');
    warnings.push('Sanitized answer prose to remove punitive/judgment phrasing');
  }

  if (invalidFactIds.length > 0) {
    warnings.push(`Filtered ${invalidFactIds.length} invalid/hallucinated fact IDs: ${Array.from(new Set(invalidFactIds)).join(', ')}`);
  }
  if (droppedClaims.length > 0) {
    warnings.push(`Dropped ${droppedClaims.length} ungrounded claims: ${droppedClaims.map((c) => `"${c.text}" (${c.reason})`).join('; ')}`);
  }
  if (droppedRecommendations.length > 0) {
    warnings.push(`Dropped ${droppedRecommendations.length} ungrounded recommendations: ${droppedRecommendations.map((r) => `"${r.text}" (${r.reason})`).join('; ')}`);
  }

  return {
    valid: true,
    sanitizedSynthesis: {
      answer: sanitizedAnswer,
      claims: sanitizedClaims,
      recommendations: sanitizedRecommendations,
      drilldowns: synthesis.drilldowns || [],
    },
    invalidFactIds,
    droppedClaims,
    droppedRecommendations,
    warnings,
  };
}

/**
 * Collect all authorized numeric values from the specified fact IDs.
 */
export function collectAllowedNumbersForFactIds(factIds: string[], factMap: Map<string, Fact>): Set<number> {
  const allowed = new Set<number>();

  for (const id of factIds) {
    const fact = factMap.get(id);
    if (!fact) continue;

    if (typeof fact.value === 'number') {
      addNumberAndVariants(allowed, fact.value);
    }
    if (typeof fact.numerator === 'number') {
      addNumberAndVariants(allowed, fact.numerator);
    }
    if (typeof fact.denominator === 'number') {
      addNumberAndVariants(allowed, fact.denominator);
    }

    if (fact.metadata && typeof fact.metadata === 'object') {
      collectNumbersFromObject(allowed, fact.metadata);
    }
  }

  return allowed;
}

function collectNumbersFromObject(set: Set<number>, obj: Record<string, unknown>) {
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      addNumberAndVariants(set, val);
      // If key is idle_time_seconds, also allow minutes and hours
      if (key.includes('seconds') && val > 60) {
        addNumberAndVariants(set, Math.round(val / 60));
        addNumberAndVariants(set, Number((val / 3600).toFixed(1)));
        addNumberAndVariants(set, Math.round(val / 3600));
      }
    } else if (typeof val === 'string') {
      const parsed = parseFloat(val.replace(',', '.'));
      if (!isNaN(parsed) && Number.isFinite(parsed)) {
        addNumberAndVariants(set, parsed);
      }
    } else if (val && typeof val === 'object') {
      collectNumbersFromObject(set, val as Record<string, unknown>);
    }
  }
}

function addNumberAndVariants(set: Set<number>, n: number) {
  set.add(n);
  // Add 1-decimal rounded
  set.add(Number(n.toFixed(1)));
  // Add 2-decimal rounded
  set.add(Number(n.toFixed(2)));
  // Add integer rounded
  set.add(Math.round(n));

  // If percentage expressed as 0..1 (e.g. 0.5), also add 50
  if (n > 0 && n <= 1) {
    set.add(Number((n * 100).toFixed(1)));
    set.add(Math.round(n * 100));
  }
  // If percentage expressed as 0..100 (e.g. 50), also add 0.5
  if (n > 1 && n <= 100) {
    set.add(Number((n / 100).toFixed(3)));
  }
}

/**
 * Extracts numbers from prose and checks them against allowed numbers.
 */
export function validateClaimNumbers(
  text: string,
  allowedNumbers: Set<number>
): { valid: boolean; unsupportedNumbers: number[] } {
  // Regex to extract numbers from Portuguese prose
  // Matches e.g. "39", "23", "59%", "38,5%", "38.5%", "1.500", "0"
  // Excludes structural identifiers like F1, F2, LEAD_1, LEAD_2
  
  // Clean structural tokens first
  const sanitizedText = text
    .replace(/\bF\d+\b/gi, ' ')
    .replace(/\bLEAD_\d+\b/gi, ' ')
    .replace(/\b(202\d)\b/g, ' ') // Years like 2024, 2025, 2026
    .replace(/\b(7d|30d|24h)\b/gi, ' '); // Standard period tokens

  // Match numbers: optionally with thousands dot/comma, decimal dot/comma, optional %
  const numberRegex = /(?:\b|\b\+|-)(\d+(?:[.,]\d+)?)(?:%|\b)/g;
  const unsupported: number[] = [];

  let match: RegExpExecArray | null;
  while ((match = numberRegex.exec(sanitizedText)) !== null) {
    const rawMatch = match[1];
    const normalizedStr = rawMatch.replace(',', '.');
    const parsed = parseFloat(normalizedStr);

    if (isNaN(parsed)) continue;

    // Check if parsed number exists in allowed set (within 0.05 tolerance for rounding)
    let matched = false;
    for (const allowed of allowedNumbers) {
      if (Math.abs(parsed - allowed) < 0.05) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      unsupported.push(parsed);
    }
  }

  return {
    valid: unsupported.length === 0,
    unsupportedNumbers: unsupported,
  };
}

/**
 * Detects punitive recommendations or personal judgments about employees.
 */
export function isPunitiveOrInsultingOutput(text: string): boolean {
  const lower = text.toLowerCase();
  const punitivePatterns = [
    /\bdemit(?:ir|ido|ida|am|a|em|a-lo|a-la)\b/i,
    /\bdemiss(?:ao|ão)\b/i,
    /\bpunir\b/i,
    /\bpuniç(?:ao|ão)\b/i,
    /\badvert(?:ir|ência|encia)\b/i,
    /\bsuspend(?:er|ido|ida|am)\b/i,
    /\bsuspens(?:ao|ão)\b/i,
    /\breduzir\s+(?:a\s+|o\s+)?(?:sal[aá]rio|comiss[aã]o)\b/i,
    /\bcortar\s+(?:a\s+|o\s+)?(?:sal[aá]rio|comiss[aã]o)\b/i,
    /\bpreguiços[oa]s?\b/i,
    /\bincompetente?s?\b/i,
    /\bburr[oa]s?\b/i,
    /\bincapaz(?:es)?\b/i,
    /\bdesonest[oa]s?\b/i,
    /\bp[eé]ssimo\s+vendedor\b/i,
    /\bpior\s+vendedor\b/i,
  ];

  return punitivePatterns.some((pattern) => pattern.test(lower));
}

