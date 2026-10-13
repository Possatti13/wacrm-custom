// @vitest-environment jsdom
import React, { useCallback, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './header';
import { Sidebar } from './sidebar';

const fixture = vi.hoisted(() => ({
  desktop: true,
  pathname: '/inbox',
  role: 'owner',
  auth: { profile: { full_name: 'Operador QA', email: 'qa@example.invalid' }, profileLoading: false, account: { name: 'Workspace QA' }, signOut: vi.fn() },
}));
vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => ({ openMenu: 'Abrir menu', closeMenu: 'Fechar menu', inbox: 'Conversas', tasks: 'Follow-ups', dashboard: 'Cockpit', catalog: 'Catálogo', contacts: 'Contatos', settings: 'Configurações' }[key] ?? key) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ ...fixture.auth, accountRole: fixture.role }) }));
vi.mock('@/hooks/use-total-unread', () => ({ useTotalUnread: () => 0 }));
vi.mock('@/hooks/use-unread-notifications', () => ({ useUnreadNotifications: () => 0 }));
vi.mock('@/components/layout/mode-toggle', () => ({ ModeToggle: () => null }));

function Workspace() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return <div onClickCapture={event => { if ((event.target as Element).closest('a')) event.preventDefault(); }}>
    <Sidebar open={open} onClose={close} triggerRef={triggerRef} />
    <Header onOpenSidebar={() => setOpen(value => !value)} sidebarOpen={open} sidebarTriggerRef={triggerRef} />
    <main><input aria-label="Texto do workspace" defaultValue="Preservar" /></main>
  </div>;
}
beforeEach(() => {
  fixture.desktop = true; fixture.pathname = '/inbox'; fixture.role = 'owner';
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: fixture.desktop, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(cleanup);

describe('Workspace desktop navigation drawer', () => {
  it('starts closed without an in-flow desktop sidebar', () => {
    const view = render(<Workspace />);
    expect(view.container.querySelector('aside')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir menu' }).className).not.toContain('lg:hidden');
  });
  it('opens one accessible navigation tree and preserves the workspace', async () => {
    render(<Workspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Navegação principal' });
    expect(dialog.querySelectorAll('a[href="/tasks"]').length).toBe(1);
    expect(dialog.querySelector('a[href="/inbox"]')?.getAttribute('aria-current')).toBe('page');
    expect((screen.getByLabelText('Texto do workspace') as HTMLInputElement).value).toBe('Preservar');
  });
  it('closes with Escape and restores focus to its opening control', async () => {
    render(<Workspace />);
    const trigger = screen.getByRole('button', { name: 'Abrir menu' }); trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Navegação principal' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('closes after choosing a route, including the active route', async () => {
    render(<Workspace />); fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    await screen.findByRole('dialog', { name: 'Navegação principal' });
    fireEvent.click(screen.getByRole('link', { name: 'Conversas' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('closes when navigation changes the pathname', async () => {
    const view = render(<Workspace />); fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    await screen.findByRole('dialog', { name: 'Navegação principal' });
    fixture.pathname = '/tasks'; view.rerender(<Workspace />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  for (const role of ['agent', 'viewer']) {
    it(`preserves the ${role} destinations without manager links`, async () => {
      fixture.role = role; render(<Workspace />); fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
      const dialog = await screen.findByRole('dialog', { name: 'Navegação principal' });
      expect(dialog.querySelector('a[href="/catalog"]')).toBeNull();
      expect(dialog.querySelector('a[href="/dashboard"]')).toBeNull();
      expect(dialog.querySelector('a[href="/settings?tab=profile"]')).not.toBeNull();
    });
  }
});
