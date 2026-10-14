// @vitest-environment jsdom
import React, { useEffect, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { Conversation } from '@/types';
import InboxPage from './page';

const fixtures = vi.hoisted(() => ({ rows: [] as Conversation[], delayed: false }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/hooks/use-realtime', () => ({ useRealtime: () => ({ isConnected: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));
// Keep the modal boundary observable even during its closed/exit state. Real
// Sheet portals can remain mounted while exit animations finish; a breakpoint
// must unmount that boundary instead of hiding only its popup with CSS.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => <div data-testid="context-sheet" data-open={open}>{open && children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/inbox/intelligence-sidebar', () => ({
  IntelligenceSidebar: ({ conversationId }: { conversationId?: string }) => <output data-testid="context">{conversationId ?? 'none'}</output>,
}));
vi.mock('@/components/inbox/conversation-list', () => ({
  ConversationList: ({ onSelect, onConversationsLoaded, resyncToken }: {
    onSelect: (row: Conversation) => void; onConversationsLoaded: (rows: Conversation[]) => void; resyncToken: number;
  }) => {
    const loadedRef = useRef(onConversationsLoaded);
    useEffect(() => { loadedRef.current = onConversationsLoaded; });
    useEffect(() => { if (!fixtures.delayed) loadedRef.current(fixtures.rows); }, [resyncToken]);
    return <><button onClick={() => onConversationsLoaded(fixtures.rows)}>Load list</button>{fixtures.rows.map(row => <button key={row.id} onClick={() => onSelect(row)}>Select {row.id}</button>)}</>;
  },
}));
vi.mock('@/components/inbox/message-thread', () => ({
  MessageThread: ({ conversation, onRefresh, onBack, onToggleContactPanel }: {
    conversation: Conversation | null; onRefresh: () => void; onBack: () => void; onToggleContactPanel: () => void;
  }) => <><output data-testid="thread">{conversation?.id ?? 'none'}</output><button onClick={onRefresh}>Refresh conversation</button><button onClick={onBack}>Close conversation</button><button onClick={onToggleContactPanel}>Toggle context</button><input aria-label="Draft" /></>,
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const originalReplace = window.history.replaceState.bind(window.history);
const router = { back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };
let navigate: (id: string | null) => void;
let resize: (width: number) => void;

// Next's documented History API bridge publishes the new search params. The
// actual optimized-router failure is also reproduced in the local Next app;
// this DOM test keeps that bridge deterministic, without a server or provider.
function Harness() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  useEffect(() => {
    const publish = () => setParams(new URLSearchParams(location.search));
    vi.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
      originalReplace(data, unused, url); publish();
    });
    navigate = id => { originalReplace(null, '', id ? `/inbox?c=${id}` : '/inbox'); publish(); };
    return () => { vi.restoreAllMocks(); };
  }, []);
  return <AppRouterContext.Provider value={router}><SearchParamsContext.Provider value={params}><InboxPage /></SearchParamsContext.Provider></AppRouterContext.Provider>;
}
function open(id: string | null = A) {
  originalReplace(null, '', id ? `/inbox?c=${id}` : '/inbox');
  return render(<Harness />);
}
function select(id: string) { fireEvent.click(screen.getByText(`Select ${id}`)); }
function expectSelection(id: string | null) {
  expect(screen.getByTestId('thread').textContent).toBe(id ?? 'none');
  expect(screen.getByTestId('context').textContent).toBe(id ?? 'none');
  expect(new URLSearchParams(location.search).get('c')).toBe(id);
}
beforeEach(() => {
  fixtures.delayed = false;
  fixtures.rows = [A, B].map(id => ({ id, unread_count: 0, contact: { id: `contact-${id}` } } as Conversation));
  let width = 1920;
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => width });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ get matches() { return width >= 1440; }, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }) });
  resize = next => { width = next; listeners.forEach(listener => listener()); };
});

describe('Inbox commercial context breakpoint', () => {
  it('has no modal boundary in the fixed desktop context mode', () => {
    open();
    expect(screen.queryByTestId('context-sheet')).toBeNull();
  });
  it('unmounts the entire modal on narrow -> wide without remounting thread/draft or changing selection', () => {
    resize(390); open();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByText('Toggle context'));
    expect(screen.getByTestId('context-sheet').getAttribute('data-open')).toBe('true');
    act(() => resize(1440));
    expect(screen.queryByTestId('context-sheet')).toBeNull();
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Keep this draft');
    expectSelection(A);
  });
  it('returns to narrow mode closed and can open the context again', () => {
    resize(1366); open(); fireEvent.click(screen.getByText('Toggle context'));
    act(() => resize(1920)); act(() => resize(1280));
    expect(screen.getByTestId('context-sheet').getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByText('Toggle context'));
    expect(screen.getByTestId('context-sheet').getAttribute('data-open')).toBe('true');
  });
  it('keeps the Sheet open between viewports below the fixed-context breakpoint', () => {
    resize(1024); open(); fireEvent.click(screen.getByText('Toggle context'));
    act(() => resize(1366));
    expect(screen.getByTestId('context-sheet').getAttribute('data-open')).toBe('true');
  });
});
afterEach(cleanup);

describe('Inbox URL and conversation selection', () => {
  it('opens A by direct link once the list loads', () => { open(); expectSelection(A); });
  it('selects B and commits URL B together with thread/context B', () => { open(); select(B); expectSelection(B); });
  it('reload keeps B, rather than restoring the previous deep link A', () => {
    const view = open(); select(B); const id = new URLSearchParams(location.search).get('c'); view.unmount(); open(id); expectSelection(B);
  });
  it('supports A -> B -> A with no extra router navigation', () => { open(); select(B); expectSelection(B); select(A); expectSelection(A); expect(router.replace).not.toHaveBeenCalled(); });
  it('converges to B during rapid A/B changes', () => { open(); act(() => { select(B); select(A); select(B); }); expectSelection(B); });
  it('converges back to A even before React commits the preceding B click', () => { open(); act(() => { select(B); select(A); }); expectSelection(A); });
  it('resolves a parameter that arrives before the list', () => { fixtures.delayed = true; open(B); expect(screen.getByTestId('thread').textContent).toBe('none'); fireEvent.click(screen.getByText('Load list')); expectSelection(B); });
  it('does not select another conversation for an unavailable UUID', () => { open(); act(() => navigate('unavailable')); expect(screen.getByTestId('thread').textContent).toBe('none'); expect(screen.getByTestId('context').textContent).toBe('none'); });
  it('honors a new deep link with the list already loaded (return from Follow-ups)', () => { open(); act(() => navigate(B)); expectSelection(B); });
  it('manual refresh keeps the currently selected conversation', () => { open(); select(B); fireEvent.click(screen.getByText('Refresh conversation')); expectSelection(B); });
  it('reflects browser traversal of search params without requiring another list fetch', () => { open(); act(() => navigate(B)); expectSelection(B); act(() => navigate(A)); expectSelection(A); });
  it('mobile close clears both URL and selection; reselect/reload remains possible', () => { open(); fireEvent.click(screen.getByText('Close conversation')); expectSelection(null); select(B); expectSelection(B); });
  it('re-clicking the active row preserves selection', () => { open(); select(A); expectSelection(A); });
});
