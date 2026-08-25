import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { executeOnDemandAiAction } from '@/lib/intelligence/on-demand';
import type { ActionType } from '@/lib/intelligence/types';

export async function POST(req: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const body = await req.json();

    const { targetType, targetId, actionType, forceRefresh, queryText } = body as {
      targetType: 'conversation' | 'contact' | 'account' | 'query';
      targetId?: string | null;
      actionType: ActionType;
      forceRefresh?: boolean;
      queryText?: string;
    };

    if (!targetType || !actionType) {
      return NextResponse.json(
        { error: 'targetType and actionType are required' },
        { status: 400 }
      );
    }

    const result = await executeOnDemandAiAction(supabase, {
      accountId,
      userId: userId || null,
      targetType,
      targetId,
      actionType,
      forceRefresh: Boolean(forceRefresh),
      queryText,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
