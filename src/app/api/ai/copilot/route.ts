import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { runCopilotAction } from '@/lib/copilot/service';
import type { CopilotRequest } from '@/lib/copilot/types';

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const body = (await req.json()) as CopilotRequest;

    if (!body.action || !body.conversationId) {
      return NextResponse.json(
        { error: 'action and conversationId are required' },
        { status: 400 }
      );
    }

    const result = await runCopilotAction(supabase, accountId, body);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
