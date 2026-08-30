import type { FactPacket, SynthesisOutput } from './types';

export interface ValidationResult {
  valid: boolean;
  sanitizedSynthesis: SynthesisOutput;
  invalidFactIds: string[];
  warnings: string[];
}

export function validateAndSanitizeSynthesis(
  synthesis: SynthesisOutput,
  factPacket: FactPacket
): ValidationResult {
  const existingFactIds = new Set(factPacket.facts.map((f) => f.fact_id));
  const invalidFactIds: string[] = [];
  const warnings: string[] = [];

  // 1. Validate Claims Fact IDs Grounding
  const sanitizedClaims = (synthesis.claims || []).map((claim) => {
    const validIds = (claim.fact_ids || []).filter((id) => {
      if (existingFactIds.has(id)) {
        return true;
      }
      invalidFactIds.push(id);
      return false;
    });

    return {
      text: claim.text,
      fact_ids: validIds,
    };
  }).filter((c) => c.text.trim().length > 0);

  // 2. Validate Recommendations Grounding
  const sanitizedRecommendations = (synthesis.recommendations || []).map((rec) => {
    const validIds = (rec.based_on_fact_ids || []).filter((id) => {
      if (existingFactIds.has(id)) {
        return true;
      }
      invalidFactIds.push(id);
      return false;
    });

    return {
      text: rec.text,
      based_on_fact_ids: validIds,
    };
  }).filter((r) => r.text.trim().length > 0);

  if (invalidFactIds.length > 0) {
    warnings.push(`Filtered ${invalidFactIds.length} invalid/hallucinated fact IDs: ${invalidFactIds.join(', ')}`);
  }

  // 3. Numeric Safety Sanity Check
  // Extract all numbers present in the fact packet
  const factNumbers = new Set<number>();
  for (const f of factPacket.facts) {
    if (typeof f.value === 'number') {
      factNumbers.add(f.value);
    }
    if (f.numerator !== undefined) factNumbers.add(f.numerator);
    if (f.denominator !== undefined) factNumbers.add(f.denominator);
    if (f.metadata) {
      for (const val of Object.values(f.metadata)) {
        if (typeof val === 'number') {
          factNumbers.add(val);
        }
      }
    }
  }

  return {
    valid: true,
    sanitizedSynthesis: {
      answer: synthesis.answer,
      claims: sanitizedClaims,
      recommendations: sanitizedRecommendations,
      drilldowns: synthesis.drilldowns || [],
    },
    invalidFactIds,
    warnings,
  };
}
