import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { askCiclopes } from '@/lib/analytics/ask-ciclopes/service';

export async function POST(request: Request) {
  try {
    // 1. Authenticate and enforce manager role (Owner or Admin)
    const ctx = await requireRole('admin');

    // 2. Validate request body
    const body = await request.json().catch(() => null);
    if (!body || typeof body.question !== 'string') {
      return NextResponse.json(
        { error: 'Parâmetro "question" é obrigatório e deve ser uma string.' },
        { status: 400 }
      );
    }

    const question = body.question.trim();
    if (question.length < 2) {
      return NextResponse.json(
        { error: 'A pergunta deve conter ao menos 2 caracteres.' },
        { status: 400 }
      );
    }

    if (question.length > 1000) {
      return NextResponse.json(
        { error: 'A pergunta excede o tamanho máximo de 1000 caracteres.' },
        { status: 400 }
      );
    }

    const threadId = typeof body.threadId === 'string' ? body.threadId : undefined;
    const forceRefresh = Boolean(body.forceRefresh);

    // 3. Execute Ask Ciclopes Pipeline
    const result = await askCiclopes(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      userRole: ctx.role as 'owner' | 'admin',
      question,
      threadId,
      forceRefresh,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (threadId) {
      // Fetch turns for a specific thread
      const { data: turns, error: turnsErr } = await ctx.supabase
        .from('manager_ai_turns')
        .select('*')
        .eq('thread_id', threadId)
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: true });

      if (turnsErr) {
        return NextResponse.json({ error: turnsErr.message }, { status: 500 });
      }

      return NextResponse.json({ turns });
    }

    // List recent threads
    const { data: threads, error } = await ctx.supabase
      .from('manager_ai_threads')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .order('updated_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ threads });
  } catch (err) {
    return toErrorResponse(err);
  }
}
