import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ConversationInsight,
  ConversationInsightWithEvidence,
  CreateInsightInput,
  SupersedeInsightInput,
  InsightStatus,
  InsightType,
  ConversationAnalysisRun,
  ConversationAnalysisState,
} from './types'
import {
  createConversationInsight,
  supersedeConversationInsight,
  retractConversationInsight,
  getInsightWithEvidence,
  listConversationInsights,
  getUnanalyzedMessages,
  recordAnalysisRun,
  recordAnalyzedMessages,
  getAnalysisState,
  updateAnalysisState,
} from './repository'

export class ConversationInsightsService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly accountId: string
  ) {
    if (!accountId || typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new Error('ConversationInsightsService requires a valid accountId')
    }
  }

  // Insight Operations
  async createInsight(
    conversationId: string,
    input: CreateInsightInput
  ): Promise<ConversationInsightWithEvidence> {
    return createConversationInsight(this.db, this.accountId, conversationId, input)
  }

  async supersedeInsight(
    conversationId: string,
    originalInsightId: string,
    input: SupersedeInsightInput
  ): Promise<ConversationInsightWithEvidence> {
    return supersedeConversationInsight(this.db, this.accountId, conversationId, originalInsightId, input)
  }

  async retractInsight(
    conversationId: string,
    insightId: string,
    reason: string
  ): Promise<ConversationInsight> {
    return retractConversationInsight(this.db, this.accountId, conversationId, insightId, reason)
  }

  async getInsight(
    conversationId: string,
    insightId: string
  ): Promise<ConversationInsightWithEvidence | null> {
    return getInsightWithEvidence(this.db, this.accountId, conversationId, insightId)
  }

  async listInsights(
    conversationId: string,
    options?: {
      status?: InsightStatus
      insightType?: InsightType
    }
  ): Promise<ConversationInsightWithEvidence[]> {
    return listConversationInsights(this.db, this.accountId, conversationId, options)
  }

  // Server-Side Analysis Ledger Helpers
  async getUnanalyzedMessages(
    conversationId: string,
    extractorVersion = 'v1'
  ): Promise<Array<{ id: string; conversation_id: string; content_text: string | null; created_at: string }>> {
    return getUnanalyzedMessages(this.db, this.accountId, conversationId, extractorVersion)
  }

  async recordRun(
    conversationId: string,
    runData: {
      status: 'completed' | 'failed' | 'processing'
      fromCursorTimestamp?: string | null
      fromCursorMessageId?: string | null
      toCursorTimestamp?: string | null
      toCursorMessageId?: string | null
      messagesCount: number
      insightsCount: number
      extractorVersion?: string
      provider?: string | null
      model?: string | null
      errorCode?: string | null
      errorMessage?: string | null
      startedAt?: string | null
      completedAt?: string | null
    }
  ): Promise<ConversationAnalysisRun> {
    return recordAnalysisRun(this.db, this.accountId, conversationId, runData)
  }

  async markMessagesAnalyzed(
    conversationId: string,
    messageIds: string[],
    analysisRunId: string,
    extractorVersion = 'v1'
  ): Promise<void> {
    return recordAnalyzedMessages(this.db, this.accountId, conversationId, messageIds, analysisRunId, extractorVersion)
  }

  async getState(
    conversationId: string,
    extractorVersion = 'v1'
  ): Promise<ConversationAnalysisState | null> {
    return getAnalysisState(this.db, this.accountId, conversationId, extractorVersion)
  }

  async updateState(
    conversationId: string,
    extractorVersion: string,
    stateData: {
      lastAnalyzedMessageCreatedAt?: string | null
      lastAnalyzedMessageId?: string | null
      lastAnalysisRunId?: string | null
    }
  ): Promise<ConversationAnalysisState> {
    return updateAnalysisState(this.db, this.accountId, conversationId, extractorVersion, stateData)
  }
}
