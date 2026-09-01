import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { runCopilotAction } from '@/lib/copilot/service';
import { routeCopilotQuery } from '@/lib/copilot/router';
import type { CopilotRequest } from '@/lib/copilot/types';

export async function POST(req: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const body = (await req.json()) as CopilotRequest & { query?: string };

    // If a global workspace query is sent without a conversation context
    if (body.query && !body.conversationId) {
      const result = await routeCopilotQuery(supabase, accountId, body.query, {
        contactId: body.contactId,
        conversationId: body.conversationId,
        userId: userId,
      });
      return NextResponse.json(result);
    }

    const conversationId = body.conversationId;
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Parâmetro conversationId (ou query global) é obrigatório.' },
        { status: 400 }
      );
    }

    const action = body.action || (body.query || body.customPrompt ? 'custom_query' : 'suggest_reply');
    const customPrompt = body.customPrompt || body.query;

    const result = await runCopilotAction(supabase, accountId, {
      ...body,
      action,
      conversationId,
      customPrompt,
    });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
