// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@/types/tasks';
import { TasksView } from './tasks-view';
import { FollowupCard } from './followup-card';

const fixture = vi.hoisted(() => ({
  auth: { accountId: 'test-account', user: { id: 'test-operator' } },
  lead: { contact_id: 'contact-B', conversation_id: '22222222-2222-4222-8222-222222222222', contact_name: 'Mariana', contact_phone: '5511988881111', lead_score: null, inactive_hours: 80 },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => fixture.auth }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/tasks/repository', () => ({
  getCockpitFollowups: async () => ({ items: [], total: 0 }),
  getLeadsWithoutNextAction: async () => ({ items: [fixture.lead], total: 1 }),
  getForgottenLeads: async () => ({ items: [fixture.lead], total: 1 }),
  createTask: vi.fn(), completeFollowup: vi.fn(), snoozeFollowup: vi.fn(),
}));
vi.mock('./create-followup-dialog', () => ({ CreateFollowupDialog: () => null }));
vi.mock('./snooze-popover', () => ({ SnoozePopover: () => null }));
afterEach(cleanup);

describe('Follow-ups to Inbox navigation', () => {
  // A real document link avoids the optimized router reusing the canonical
  // query from a previously loaded Inbox. The staging reproduction separately
  // exercises that cache behavior; these tests protect each rendered target.
  for (const label of ['Sem próxima ação', 'Leads esquecidos']) {
    it(`opens the exact conversation from ${label} using a document link`, async () => {
      render(<TasksView />);
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
      const link = await screen.findByRole('link', { name: 'Abrir conversa' });
      expect(link.getAttribute('href')).toBe(`/inbox?c=${fixture.lead.conversation_id}`);
    });
  }
  it('uses the same c parameter for a scheduled follow-up', () => {
    render(<FollowupCard task={{ id: 'task', title: 'Retomar contato', conversation_id: fixture.lead.conversation_id, status: 'completed', action_type: 'message' } as Task} onComplete={vi.fn()} onSnooze={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Abrir conversa' }).getAttribute('href')).toBe(`/inbox?c=${fixture.lead.conversation_id}`);
  });
  it('keeps the action disabled when the follow-up has no target', () => {
    render(<FollowupCard task={{ id: 'task', title: 'Sem alvo', status: 'completed', action_type: 'message' } as Task} onComplete={vi.fn()} onSnooze={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Abrir conversa' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
