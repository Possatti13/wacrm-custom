import { isTechnicalContent } from '@/lib/messages/presentation';

const UNAVAILABLE = 'Registro histórico indisponível para apresentação';

export function getHistoricalTextPresentation(text?: string | null) {
  const value = text ?? '';
  const technicalTerm =
    /\b(?:base64|payload|encoding|binary|bin[aá]ri[oa]s?|corrupted|corrompid[oa]s?|waha|webhook|json|blob)\b/i;
  const diagnosticContext =
    /dados?|conte[uú]do|mensage(?:m|ns)|process|extra[cç][aã]o|extract|unreadable|readable|provider|inv[aá]lid|falh|failed|error|erro|corrompid|corrupted|codificad|reenvio|desconsiderar|disfarçad|prevent|rather than/i;
  const diagnostic = technicalTerm.test(value) && diagnosticContext.test(value);
  const englishFailure =
    /\b(?:extraction|processing|provider)\b.{0,80}\b(?:failed|error|unavailable)\b/i.test(
      value
    );
  return isTechnicalContent(value) || diagnostic || englishFailure
    ? { text: UNAVAILABLE, available: false }
    : { text: value, available: true };
}

export function getInsightPresentation(insight: {
  value_text?: string | null;
  evidence?: Array<{ snippet?: string | null }>;
}) {
  const value = getHistoricalTextPresentation(insight.value_text);
  if (
    insight.evidence?.some(
      (e) => !getHistoricalTextPresentation(e.snippet).available
    )
  ) {
    return { text: UNAVAILABLE, available: false };
  }
  return value;
}
