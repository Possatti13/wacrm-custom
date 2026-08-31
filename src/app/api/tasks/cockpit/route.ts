import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getCockpitFollowups,
  getLeadsWithoutNextAction,
  getForgottenLeads,
} from '@/lib/tasks/repository';
import type { CockpitView } from '@/types/tasks';

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
  const view = (searchParams.get('view') || 'today') as CockpitView;
  const assignedUserId = searchParams.get('assigned_user_id') || undefined;
  const limit = Math.min(Number(searchParams.get('limit') || 50), 100);
  const offset = Number(searchParams.get('offset') || 0);

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 400 });
  }

  const accountId = profile.account_id;
  // If user is agent and no specific filter requested, they can filter by themselves or see assigned
  const effectiveAssignedUser =
    profile.account_role === 'agent' && !assignedUserId ? user.id : assignedUserId;

  try {
    if (view === 'no_next_action') {
      const result = await getLeadsWithoutNextAction(supabase, accountId, {
        assigned_user_id: effectiveAssignedUser,
        limit,
        offset,
      });
      return NextResponse.json({ view, ...result });
    }

    if (view === 'forgotten') {
      const inactiveHours = Number(searchParams.get('inactive_hours') || 72);
      const result = await getForgottenLeads(supabase, accountId, {
        assigned_user_id: effectiveAssignedUser,
        inactive_hours: inactiveHours,
        limit,
        offset,
      });
      return NextResponse.json({ view, ...result });
    }

    const result = await getCockpitFollowups(supabase, accountId, {
      assigned_user_id: effectiveAssignedUser,
      view,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
