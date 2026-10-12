import {
  getHistoricalTextPresentation,
  getInsightPresentation,
} from '@/lib/intelligence/presentation';
import type { ConversationInsightWithEvidence } from '@/lib/insights/types';

/** These projections retain the original records in the caller; no data is rewritten. */
export function InsightValueText({
  insight,
}: {
  insight: ConversationInsightWithEvidence;
}) {
  const presentation = getInsightPresentation(insight);
  return (
    <span className="text-foreground text-xs leading-snug font-semibold">
      {presentation.text || insight.insight_type}
    </span>
  );
}

export function InsightEvidenceText({ snippet }: { snippet: string | null }) {
  const presentation = getHistoricalTextPresentation(snippet);
  return presentation.available ? (
    <p className="italic">&ldquo;{presentation.text}&rdquo;</p>
  ) : (
    <p>{presentation.text}</p>
  );
}
