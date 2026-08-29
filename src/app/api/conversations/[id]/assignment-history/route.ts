import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { fetchAssignmentHistory } from '@/lib/account/assignment';

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const conversationId = params.id;
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation ID is required' }, { status: 400 });
    }

    const ctx = await getCurrentAccount();
    const history = await fetchAssignmentHistory(ctx.supabase, ctx.accountId, conversationId);

    return NextResponse.json({ history });
  } catch (err) {
    return toErrorResponse(err);
  }
}
