import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { runCopilotAction } from '@/lib/copilot/service';
import { routeCopilotQuery } from '@/lib/copilot/router';
import type { CopilotRequest } from '@/lib/copilot/types';

export async function POST(req: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const body = (await req.json()) as CopilotRequest & { query?: string };

    if (body.query) {
      const result = await routeCopilotQuery(supabase, accountId, body.query, {
        contactId: body.contactId,
        conversationId: body.conversationId,
        userId: userId,
      });
      return NextResponse.json(result);
    }

    if (!body.action || !body.conversationId) {
      return NextResponse.json(
        { error: 'action and conversationId (or query) are required' },
        { status: 400 }
      );
    }

    const result = await runCopilotAction(supabase, accountId, body);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
