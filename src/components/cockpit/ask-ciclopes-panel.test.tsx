// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskCiclopesPanel } from './ask-ciclopes-panel';
import type {
  AskCiclopesResult,
  OpaqueLeadEntity,
} from '@/lib/analytics/ask-ciclopes/types';

const fixture = vi.hoisted(() => ({ email: 'owner@example.com', userEmail: null as string | null }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    profile: { email: fixture.email },
    user: fixture.userEmail ? { email: fixture.userEmail } : null,
    account: { name: 'Workspace' },
  }),
}));
const conversationId = '11111111-1111-4111-8111-111111111111';
const lead = {
  lead_token: 'LEAD_1',
  contact_id: 'contact-1',
  contact_name: 'Contato autorizado',
  conversation_id: conversationId,
  phone: '+351 912 345 678',
  score: 85,
  reasons: ['Perguntou sobre financiamento'],
  score_tier: 'hot',
};
const result = (
  entities: Record<string, Partial<OpaqueLeadEntity>> = {},
  overrides: Partial<AskCiclopesResult> = {}
): AskCiclopesResult => ({
  requestId: 'request',
  threadId: 'thread',
  turnId: 'turn',
  question: 'Quem precisa de atenção?',
  answer: 'Estas oportunidades merecem atenção.',
  claims: [],
  recommendations: [],
  drilldowns: [],
  facts: [],
  opaqueEntities: entities as AskCiclopesResult['opaqueEntities'],
  resolvedPeriod: { range: '30d' },
  cached: false,
  provider: 'mock',
  model: 'deterministic',
  latencyMs: 50,
  createdAt: '2026-10-13T12:00:00Z',
  ...overrides,
});
const ask = async (
  data: AskCiclopesResult,
  props: Partial<React.ComponentProps<typeof AskCiclopesPanel>> = {}
) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => data }))
  );
  render(
    <div
      onClickCapture={(event) => {
        if ((event.target as Element).closest('a')) event.preventDefault();
      }}
    >
      <AskCiclopesPanel isOpen onClose={vi.fn()} {...props} />
    </div>
  );
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Pergunta ao Ask Ciclopes' }),
    { target: { value: 'Quem precisa de atenção?' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
  await screen.findByText(data.answer);
};
beforeEach(() => {
  fixture.email = 'owner@example.com';
  fixture.userEmail = null;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Ask insight to action', () => {
  it('uses the authenticated test email even when a profile email is missing or stale', async () => {
    fixture.userEmail = 'operador.ux01@ciclopes.test';
    await ask(result({ LEAD_1: lead }));
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
  });
  it('positions a new answer at its question and summary instead of below its results', async () => {
    await ask(result({ LEAD_1: lead }));
    const calls = vi.mocked(Element.prototype.scrollIntoView).mock;
    expect((calls.instances.at(-1) as Element | undefined)?.getAttribute('aria-label')).toBe(
      'Resposta: Quem precisa de atenção?'
    );
  });
  it('keeps a text-only answer safe and readable without fabricated cards', async () => {
    await ask(result({}, { answer: '<script>invalid</script> Resumo' }));
    expect(screen.getByText('<script>invalid</script> Resumo')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Abrir conversa/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Resultados/ })).toBeNull();
  });
  it('renders score and the exact internal conversation deep link in the same tab', async () => {
    const close = vi.fn();
    await ask(result({ LEAD_1: lead }), { onClose: close });
    const link = screen.getByRole('link', { name: /Abrir conversa/ });
    expect(link.getAttribute('href')).toBe(`/inbox?c=${conversationId}`);
    expect(link.getAttribute('target')).toBeNull();
    expect(screen.getByText('Score 85')).toBeTruthy();
    fireEvent.click(link);
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps contact-only identity useful without inventing a conversation or score', async () => {
    await ask(
      result({
        LEAD_1: { ...lead, conversation_id: undefined, score: undefined },
      })
    );
    expect(screen.getByText(lead.contact_name)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Abrir conversa/ })).toBeNull();
    expect(screen.queryByText(/^Score/)).toBeNull();
  });
  it('refuses an invalid conversation UUID even if answer contains a valid UUID', async () => {
    await ask(
      result(
        { LEAD_1: { ...lead, conversation_id: '../../other' } },
        { answer: `Conversa ${conversationId}` }
      )
    );
    expect(screen.queryByRole('link', { name: /Abrir conversa/ })).toBeNull();
  });
  it('renders an external WhatsApp link without prefilled text or automatic send', async () => {
    await ask(result({ LEAD_1: lead }));
    const link = screen.getByRole('link', { name: /WhatsApp/ });
    expect(link.getAttribute('href')).toBe('https://wa.me/351912345678');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
  for (const phone of [
    '+0',
    '55119999999999999999',
    '11987654321',
    '123456789123@lid',
    'WhatsApp Contact',
    '5511955556666',
    'https://evil.test/5513987654321',
  ]) {
    it(`omits WhatsApp for unsuitable identity: ${phone}`, async () => {
      await ask(result({ LEAD_1: { ...lead, phone } }));
      expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
    });
  }
  it('does not promote QA contacts or the evaluation workspace to external customer actions', async () => {
    fixture.email = 'operador.ux01@ciclopes.test';
    await ask(result({ LEAD_1: lead }));
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
  });
  it('renders multiple compact results including a score of zero and no score', async () => {
    const rows = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `LEAD_${i}`,
        {
          ...lead,
          lead_token: `LEAD_${i}`,
          contact_id: `c-${i}`,
          contact_name: `Contato ${i}`,
          score: i === 0 ? 0 : i === 1 ? null : 85,
        },
      ])
    );
    await ask(result(rows));
    expect(screen.getByText('Score 0')).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: /Abrir conversa/ })
    ).toHaveLength(10);
  });
  it('only connects a drilldown backed by a deterministic fact', async () => {
    const callback = vi.fn();
    await ask(
      result(
        {},
        {
          facts: [
            {
              fact_id: 'F1',
              metric: 'hot_leads',
              label: 'Leads quentes',
              value: 5,
              source: 'manager.summary',
              drilldown_ref: { type: 'attention' },
            },
          ],
          drilldowns: [
            { label: 'Ver atenção', drilldown_ref: { type: 'attention' } },
            {
              label: 'Inventado',
              drilldown_ref: { type: 'unknown' as 'attention' },
            },
          ],
        }
      ),
      { onDrilldown: callback }
    );
    fireEvent.click(screen.getByRole('button', { name: /Ver atenção/ }));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ drilldown_ref: { type: 'attention' } })
    );
    expect(screen.queryByRole('button', { name: 'Inventado' })).toBeNull();
  });
  it('ignores arbitrary UUIDs in a model drilldown filter', async () => {
    await ask(
      result(
        { LEAD_1: lead },
        {
          facts: [
            {
              fact_id: 'F1',
              metric: 'attention_lead',
              label: 'Lead',
              value: 85,
              source: 'manager.attention',
              drilldown_ref: {
                type: 'attention',
                filter: { lead_token: 'LEAD_1' },
              },
            },
          ],
          drilldowns: [
            {
              label: 'Outro tenant',
              drilldown_ref: {
                type: 'attention',
                filter: { conversation_id: conversationId },
              },
            },
          ],
        }
      ),
      { onDrilldown: vi.fn() }
    );
    expect(screen.queryByRole('button', { name: 'Outro tenant' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Outro tenant' })).toBeNull();
  });
  it('shows the submitted question during loading and prevents duplicate requests', async () => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    render(<AskCiclopesPanel isOpen onClose={vi.fn()} />);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Pergunta ao Ask Ciclopes' }),
      { target: { value: 'Pergunta nova' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    expect(screen.getByRole('status').textContent).toContain('Analisando');
    expect(screen.getByText('Pergunta nova')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Enviar pergunta',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('retries exactly the failed question with an explicit action', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal error' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => result() });
    vi.stubGlobal('fetch', fetcher);
    render(<AskCiclopesPanel isOpen onClose={vi.fn()} />);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Pergunta ao Ask Ciclopes' }),
      { target: { value: 'Pergunta falhou' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Estas oportunidades merecem atenção.');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      question: 'Pergunta falhou',
    });
  });
  it('does not render active drilldown buttons without a destination callback', async () => {
    await ask(
      result(
        {},
        {
          facts: [
            {
              fact_id: 'F1',
              metric: 'hot_leads',
              label: 'Leads',
              value: 2,
              source: 'manager.summary',
              drilldown_ref: { type: 'attention' },
            },
          ],
          drilldowns: [
            { label: 'Sem destino', drilldown_ref: { type: 'attention' } },
          ],
        }
      )
    );
    expect(screen.queryByRole('button', { name: 'Sem destino' })).toBeNull();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Fechar Ask Ciclopes',
      })
    ).toBeTruthy();
  });
});
