import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  assignConversationAtomic,
  AssignmentConcurrencyError,
  AssignmentError,
} from '@/lib/account/assignment';

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const conversationId = params.id;
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation ID is required' }, { status: 400 });
    }

    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => ({}));
    const {
      target_user_id,
      reason,
      expected_current_agent_id,
      force,
    } = body;

    try {
      const result = await assignConversationAtomic(ctx.supabase, {
        accountId: ctx.accountId,
        conversationId,
        targetUserId: target_user_id !== undefined ? target_user_id : null,
        reason: typeof reason === 'string' ? reason.trim() : null,
        expectedCurrentAgentId: expected_current_agent_id !== undefined ? expected_current_agent_id : null,
        force: Boolean(force),
      });

      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof AssignmentConcurrencyError) {
        return NextResponse.json(
          {
            error: 'CONCURRENCY_CONFLICT',
            message: err.message,
            current_assigned_agent_id: err.currentAssignedAgentId,
          },
          { status: 409 }
        );
      }
      if (err instanceof AssignmentError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
