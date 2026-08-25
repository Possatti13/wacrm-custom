// ============================================================
// Commercial Analytics Domain Types (Phase 13)
// ============================================================

export interface LeadScoreDistribution {
  totalScored: number;
  avgScore: number;
  hotCount: number; // score >= 70
  warmCount: number; // score >= 40 and < 70
  coldCount: number; // score < 40
}

export interface ObjectionAnalyticsItem {
  objection: string;
  totalCount: number;
  openCount: number;
  resolvedCount: number;
  resolutionRate: number; // 0 to 100%
}

export interface CatalogInterestAnalyticsItem {
  itemId: string;
  itemName: string;
  itemType: string;
  interestCount: number;
}

export interface TasksAnalyticsSummary {
  pending: number;
  overdue: number;
  completedToday: number;
}

export interface CommercialAnalyticsSummary {
  leadScores: LeadScoreDistribution;
  topObjections: ObjectionAnalyticsItem[];
  topInterests: CatalogInterestAnalyticsItem[];
  tasks: TasksAnalyticsSummary;
}
