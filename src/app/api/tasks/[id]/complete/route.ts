import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { completeFollowup } from '@/lib/tasks/repository';

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const taskId = params.id;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 400 });
  }

  try {
    const updated = await completeFollowup(supabase, profile.account_id, taskId, user.id);
    return NextResponse.json({ task: updated });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to complete task';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
