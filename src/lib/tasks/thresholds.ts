// ============================================================
// Commercial Health & Follow-up Thresholds (V1.2.1)
// Centralized domain thresholds for lead and follow-up policies
// ============================================================

export const COMMERCIAL_THRESHOLDS = {
  NO_NEXT_ACTION: {
    DEFAULT_MIN_LEAD_SCORE: 40,
    DEFAULT_MAX_CONVERSATION_INACTIVE_DAYS: 30,
  },
  FORGOTTEN_LEADS: {
    DEFAULT_MIN_LEAD_SCORE: 30,
    DEFAULT_INACTIVE_HOURS: 72,
  },
} as const;
