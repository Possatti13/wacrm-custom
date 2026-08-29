import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listTasks, createTask } from '@/lib/tasks/repository';
import type { CreateTaskInput, TaskTimeframeFilter, TaskPriority, TaskStatus, ActionType, WaitingOn } from '@/types/tasks';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('account_id') || request.headers.get('x-account-id');

  // Resolve account_id from profile if not provided
  let effectiveAccountId = accountId;
  if (!effectiveAccountId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .single();
    effectiveAccountId = profile?.account_id;
  }

  if (!effectiveAccountId) {
    return NextResponse.json({ error: 'Account not found' }, { status: 400 });
  }

  const timeframe = searchParams.get('timeframe') as TaskTimeframeFilter | undefined;
  const status = searchParams.get('status') as TaskStatus | undefined;
  const priority = searchParams.get('priority') as TaskPriority | undefined;
  const action_type = searchParams.get('action_type') as ActionType | undefined;
  const waiting_on = searchParams.get('waiting_on') as WaitingOn | undefined;
  const assigned_user_id = searchParams.get('assigned_user_id') || undefined;
  const contact_id = searchParams.get('contact_id') || undefined;
  const conversation_id = searchParams.get('conversation_id') || undefined;

  try {
    const tasks = await listTasks(supabase, effectiveAccountId, {
      timeframe,
      status,
      priority,
      action_type,
      waiting_on,
      assigned_user_id,
      contact_id,
      conversation_id,
    });

    return NextResponse.json({ tasks });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  let accountId = body.account_id || request.headers.get('x-account-id');

  if (!accountId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .single();
    accountId = profile?.account_id;
  }

  if (!accountId) {
    return NextResponse.json({ error: 'Account not found' }, { status: 400 });
  }

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const input: CreateTaskInput = {
    title: body.title.trim(),
    description: body.description?.trim() || null,
    priority: body.priority || 'medium',
    action_type: body.action_type || 'other',
    waiting_on: body.waiting_on || null,
    contact_id: body.contact_id || null,
    conversation_id: body.conversation_id || null,
    deal_id: body.deal_id || null,
    assigned_user_id: body.assigned_user_id || user.id,
    created_by_user_id: user.id,
    due_at: body.due_at || null,
    source: body.source || 'manual',
    ai_suggestion_provenance: body.ai_suggestion_provenance || {},
  };

  try {
    const task = await createTask(supabase, accountId, input);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create task' }, { status: 500 });
  }
}
