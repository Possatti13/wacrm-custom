// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/(dashboard)/dashboard/page';
import type { DrilldownAction } from '@/lib/analytics/ask-ciclopes/types';

const fixture = vi.hoisted(() => ({
  action: {
    label: 'Ver atenção',
    drilldown_ref: { type: 'attention' },
  } as DrilldownAction,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account',
    profile: { account_role: 'owner' },
    loading: false,
    profileLoading: false,
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/analytics/manager-cockpit-repository', () => ({
  loadManagerCockpitSummary: async () => ({ period: {}, data_freshness: {} }),
  loadManagerAttentionQueue: async () => ({ items: [] }),
  loadManagerObjectionAnalytics: async () => ({}),
  loadManagerProductIntelligence: async () => ({}),
  loadManagerTeamPerformance: async () => ({}),
  loadManagerSignalsAndPipeline: async () => ({}),
}));
vi.mock('./cockpit-header', () => ({
  CockpitHeader: ({ onOpenAskCiclopes }: { onOpenAskCiclopes: () => void }) => (
    <button onClick={onOpenAskCiclopes}>Abrir Ask</button>
  ),
}));
vi.mock('./ask-ciclopes-panel', () => ({
  AskCiclopesPanel: ({
    isOpen,
    onDrilldown,
  }: {
    isOpen: boolean;
    onDrilldown?: (action: DrilldownAction) => void;
  }) =>
    isOpen && (
      <button onClick={() => onDrilldown?.(fixture.action)}>
        Executar ação do Ask
      </button>
    ),
}));
vi.mock('./attention-queue', () => ({
  AttentionQueue: () => <p>Fila operacional</p>,
}));
vi.mock('./executive-pulse', () => ({ ExecutivePulse: () => null }));
vi.mock('./what-changed', () => ({ WhatChanged: () => null }));
vi.mock('./objection-intelligence', () => ({
  ObjectionIntelligence: () => <p>Objeções operacionais</p>,
}));
vi.mock('./product-friction-matrix', () => ({
  ProductFrictionMatrix: () => null,
}));
vi.mock('./team-operating-table', () => ({ TeamOperatingTable: () => null }));
vi.mock('./signals-and-pipeline', () => ({ SignalsAndPipeline: () => null }));
vi.mock('./operational-health-footer', () => ({
  OperationalHealthFooter: () => null,
}));
vi.mock('./coaching-view', () => ({
  CoachingView: () => <p>Coaching operacional</p>,
}));
vi.mock('./objection-drilldown-drawer', () => ({
  ObjectionDrilldownDrawer: ({
    open,
    taxonomyCode,
  }: {
    open: boolean;
    taxonomyCode: string | null;
  }) => open && <p>Objeção detalhada: {taxonomyCode}</p>,
}));
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
describe('Ask existing cockpit destinations', () => {
  it('closes the Ask and focuses the actual attention section', async () => {
    fixture.action = {
      label: 'Ver atenção',
      drilldown_ref: { type: 'attention' },
    };
    render(<DashboardPage />);
    await screen.findByText('Fila operacional');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Ask' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Executar ação do Ask' })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Executar ação do Ask' })
      ).toBeNull()
    );
    expect(document.activeElement?.id).toBe('cockpit-attention');
  });
  it('selects the existing coaching tab', async () => {
    fixture.action = { label: 'Coaching', drilldown_ref: { type: 'coaching' } };
    render(<DashboardPage />);
    await screen.findByText('Fila operacional');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Ask' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Executar ação do Ask' })
    );
    await screen.findByText('Coaching operacional');
  });
  it('reuses the objection drawer with the supplied canonical taxonomy code', async () => {
    fixture.action = {
      label: 'Objeção',
      drilldown_ref: {
        type: 'objections',
        taxonomy_code: 'PRICE',
        title: 'Preço',
      },
    };
    render(<DashboardPage />);
    await screen.findByText('Fila operacional');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Ask' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Executar ação do Ask' })
    );
    await screen.findByText('Objeção detalhada: PRICE');
  });
});
