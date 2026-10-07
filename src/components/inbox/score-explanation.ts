export interface ScoreBreakdown {
  base_score?: number;
  raw_score?: number;
  final_score?: number;
  min_score?: number;
  max_score?: number;
  contributions?: Array<{ points: number }>;
  rule_results?: Array<{ points: number; matched: boolean }>;
}

export interface ScoreRevisionBounds {
  base_score: number;
  min_score: number;
  max_score: number;
}

export interface ScoreExplanation {
  base: number | null;
  raw: number;
  minimum: number;
  maximum: number;
  clamped: boolean;
}

export function getScoreExplanation(
  score: number,
  breakdown: ScoreBreakdown,
  revision?: ScoreRevisionBounds | null,
): ScoreExplanation | null {
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const base = breakdown.base_score ?? revision?.base_score;
  const minimum = breakdown.min_score ?? revision?.min_score;
  const maximum = breakdown.max_score ?? revision?.max_score;
  if (!finite(score) || !finite(minimum) || !finite(maximum) || minimum > maximum) return null;
  if (breakdown.final_score !== undefined && breakdown.final_score !== score) return null;

  let raw = breakdown.raw_score;
  if (raw === undefined) {
    const adjustments = breakdown.contributions ?? breakdown.rule_results?.filter(rule => rule.matched);
    if (!finite(base) || !adjustments || adjustments.some(row => !finite(row.points))) return null;
    raw = base + adjustments.reduce((sum, row) => sum + row.points, 0);
  }
  // Explain the persisted value only. Never repair/recalculate the product score
  // or infer a floor from an incomplete legacy fixture that does not reconcile.
  if (!finite(raw) || Math.max(minimum, Math.min(maximum, raw)) !== score) return null;
  return { base: finite(base) ? base : null, raw, minimum, maximum, clamped: raw !== score };
}
