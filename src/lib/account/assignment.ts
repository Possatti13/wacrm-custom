import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationAssignmentHistory, AssignmentEventType } from '@/types';

export class AssignmentError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AssignmentError';
    this.code = code;
    this.status = status;
  }
}

export class AssignmentConcurrencyError extends AssignmentError {
  readonly currentAssignedAgentId: string | null;
  constructor(message: string, currentAssignedAgentId: string | null) {
    super('CONCURRENCY_CONFLICT', message, 409);
    this.name = 'AssignmentConcurrencyError';
    this.currentAssignedAgentId = currentAssignedAgentId;
  }
}

export interface AssignConversationParams {
  accountId: string;
  conversationId: string;
  targetUserId: string | null;
  reason?: string | null;
  expectedCurrentAgentId?: string | null;
  force?: boolean;
}

export interface AssignConversationResult {
  success: boolean;
  conversationId: string;
  previousAgentId: string | null;
  assignedAgentId: string | null;
  eventType: AssignmentEventType;
  historyId?: string;
  noOp?: boolean;
}

/**
 * Execute atomic conversation assignment via the database RPC.
 * Guarantees optimistic concurrency check, audit history entry,
 * and strict multi-tenant authorization in a single database transaction.
 */
export async function assignConversationAtomic(
  db: SupabaseClient,
  params: AssignConversationParams
): Promise<AssignConversationResult> {
  const { accountId, conversationId, targetUserId, reason, expectedCurrentAgentId, force } = params;

  const { data, error } = await db.rpc('assign_conversation_atomic', {
    p_account_id: accountId,
    p_conversation_id: conversationId,
    p_target_user_id: targetUserId,
    p_reason: reason || null,
    p_expected_current_agent_id: expectedCurrentAgentId || null,
    p_force: force ?? false,
  });

  if (error) {
    if (error.message.includes('Forbidden') || error.message.includes('42501')) {
      throw new AssignmentError('forbidden', error.message, 403);
    }
    if (error.message.includes('Conversation not found') || error.message.includes('P0002')) {
      throw new AssignmentError('not_found', error.message, 404);
    }
    if (error.message.includes('Target user')) {
      throw new AssignmentError('bad_request', error.message, 400);
    }
    throw new AssignmentError('db_error', `Failed to assign conversation: ${error.message}`, 500);
  }

  const result = data as {
    success: boolean;
    error?: string;
    message?: string;
    current_assigned_agent_id?: string | null;
    conversation_id?: string;
    previous_agent_id?: string | null;
    assigned_agent_id?: string | null;
    event_type?: AssignmentEventType;
    history_id?: string;
    no_op?: boolean;
  };

  if (!result.success && result.error === 'CONCURRENCY_CONFLICT') {
    throw new AssignmentConcurrencyError(
      result.message || 'Conversation assignment was modified by another operator.',
      result.current_assigned_agent_id ?? null
    );
  }

  return {
    success: true,
    conversationId: result.conversation_id || conversationId,
    previousAgentId: result.previous_agent_id ?? null,
    assignedAgentId: result.assigned_agent_id ?? null,
    eventType: result.event_type || 'assigned',
    historyId: result.history_id,
    noOp: result.no_op,
  };
}

/**
 * Loads assignment history for a conversation, enriched with member profiles.
 */
export async function fetchAssignmentHistory(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<ConversationAssignmentHistory[]> {
  const { data: rows, error } = await db
    .from('conversation_assignment_history')
    .select('*')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  if (error || !rows) {
    return [];
  }

  // Load referenced user profiles
  const userIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.assigned_by_user_id, r.from_user_id, r.to_user_id])
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  const profileMap = new Map<string, { id: string; full_name: string; email: string | null; avatar_url: string | null }>();

  if (userIds.length > 0) {
    const { data: profiles } = await db
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url')
      .eq('account_id', accountId)
      .in('user_id', userIds);

    if (profiles) {
      for (const p of profiles) {
        const obj = { id: p.id, full_name: p.full_name || 'Operador', email: p.email, avatar_url: p.avatar_url };
        if (p.user_id) profileMap.set(p.user_id, obj);
      }
    }
  }

  return rows.map((r) => ({
    id: r.id,
    account_id: r.account_id,
    conversation_id: r.conversation_id,
    assigned_by_user_id: r.assigned_by_user_id,
    from_user_id: r.from_user_id,
    to_user_id: r.to_user_id,
    event_type: r.event_type as AssignmentEventType,
    reason: r.reason,
    created_at: r.created_at,
    assigned_by: r.assigned_by_user_id ? profileMap.get(r.assigned_by_user_id) || null : null,
    from_user: r.from_user_id ? profileMap.get(r.from_user_id) || null : null,
    to_user: r.to_user_id ? profileMap.get(r.to_user_id) || null : null,
  }));
}
