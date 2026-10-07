import { describe, expect, it } from "vitest";
import { getScoreExplanation } from "./score-explanation";
import { calculateLeadScore } from "@/lib/scoring/engine";

describe("score explanation uses recorded calculation without changing the score", () => {
  it("confirms -10 to 0 with the unchanged scoring engine when the base is zero", () => {
    const result = calculateLeadScore({
      account_id: "11111111-1111-1111-1111-111111111111", revision_number: 1,
      enabled: true, base_score: 0, min_score: 0, max_score: 100,
      rules: [{ rule_key: "withdrawal", label: "Desinteresse", signal_type: "profile_field",
        field_key: "current_intent", operator: "equals", expected_value: "not_interested", points: -10, sort_order: 0 }],
    }, {
      profile: { current_intent: "not_interested", urgency: null, sentiment: null, next_action: null, attributes: {} },
      interests: { active_item_ids: [] }, objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 0, open_objections_count: 0 },
    }, "revision", "fingerprint");
    expect(result.raw_score).toBe(-10);
    expect(result.final_score).toBe(0);
    expect(getScoreExplanation(result.final_score, result.breakdown)?.clamped).toBe(true);
  });

  it("explains an actual negative raw score clamped at zero", () => {
    expect(getScoreExplanation(0, {
      base_score: 0, raw_score: -10, final_score: 0, min_score: 0, max_score: 100,
      contributions: [{ points: -10 }],
    })).toEqual({ base: 0, raw: -10, minimum: 0, maximum: 100, clamped: true });
  });

  it("explains Juliana's legacy fixture as base 10 minus 10, without inventing a clamp", () => {
    expect(getScoreExplanation(0, { contributions: [{ points: -10 }] }, {
      base_score: 10, min_score: 0, max_score: 100,
    })).toEqual({ base: 10, raw: 0, minimum: 0, maximum: 100, clamped: false });
  });

  it("does not invent a base for Carlos when the legacy revision disagrees with his recorded 85", () => {
    expect(getScoreExplanation(85, { contributions: [{ points: 40 }, { points: 35 }, { points: 10 }] }, {
      base_score: 10, min_score: 0, max_score: 100,
    })).toBeNull();
  });

  it("preserves Carlos's complete calculation with base zero and total 85", () => {
    expect(getScoreExplanation(85, {
      base_score: 0, raw_score: 85, final_score: 85, min_score: 0, max_score: 100,
      contributions: [{ points: 40 }, { points: 35 }, { points: 10 }],
    })?.clamped).toBe(false);
  });

  it("does not assume a minimum or raw score when metadata is missing", () => {
    expect(getScoreExplanation(0, { contributions: [{ points: -10 }] })).toBeNull();
  });

  it("ignores unmatched legacy rules when reconstructing the explanation", () => {
    expect(getScoreExplanation(0, { rule_results: [{ matched: true, points: -10 }, { matched: false, points: 40 }] }, {
      base_score: 10, min_score: 0, max_score: 100,
    })?.raw).toBe(0);
  });

  it("suppresses an explanation whose recorded final value conflicts with the visible score", () => {
    expect(getScoreExplanation(0, { base_score: 0, raw_score: -10, final_score: 5, min_score: 0, max_score: 100 })).toBeNull();
  });
});
