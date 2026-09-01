// ============================================================
// Commercial Copilot Domain Types (Phase 12)
// ============================================================

export type CopilotActionType =
  | 'summarize'
  | 'suggest_reply'
  | 'overcome_objection'
  | 'match_catalog'
  | 'custom_query'
  | 'analyze_intent'
  | 'next_step';

export interface CopilotRequest {
  action: CopilotActionType;
  conversationId: string;
  contactId?: string;
  customPrompt?: string;
  tone?: 'professional' | 'consultative' | 'friendly' | 'direct';
}

export interface CopilotResponse {
  action: CopilotActionType;
  content: string;
  suggestedReply?: string;
  evidence?: string[];
  confidence?: 'high' | 'medium' | 'low';
  suggestedAction?: string;
  keyPoints?: string[];
  suggestedItems?: {
    id: string;
    name: string;
    price?: number;
    description?: string;
  }[];
}

