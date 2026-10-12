import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InsightEvidenceText, InsightValueText } from './insight-presentation';
import type { ConversationInsightWithEvidence } from '@/lib/insights/types';

const insight = (text: string): ConversationInsightWithEvidence => ({
  id: 'original',
  account_id: 'tenant',
  conversation_id: 'conversation',
  insight_type: 'summary',
  value_text: text,
  value_json: {},
  catalog_item_id: null,
  confidence: 1,
  source: 'intelligence',
  status: 'active',
  supersedes_insight_id: null,
  retracted_reason: null,
  analysis_run_id: 'run',
  dedupe_key: 'key',
  observed_at: '2026-10-09T10:00:00Z',
  created_at: '2026-10-09T10:00:00Z',
  updated_at: '2026-10-09T10:00:00Z',
  evidence: [],
});
describe('Historical intelligence actual rendered text', () => {
  it('does not render a technical insight as its original diagnosis', () => {
    const original = Object.freeze(
      insight('O cliente enviou dados binários corrompidos em base64')
    );
    const html = renderToStaticMarkup(<InsightValueText insight={original} />);
    expect(html).toContain('Registro histórico indisponível para apresentação');
    expect(html).not.toMatch(/base64|corrompid|binári/i);
    expect(original.analysis_run_id).toBe('run');
    expect(original.value_text).toContain('base64');
  });
  it('does not render encoded evidence or invent a commercial quote', () => {
    const html = renderToStaticMarkup(
      <InsightEvidenceText
        snippet={'/9j/4AAQSkZJRgABAQAAAQABAAD' + 'Ab9+/'.repeat(160)}
      />
    );
    expect(html).not.toContain('/9j/');
    expect(html).toContain('Registro histórico indisponível para apresentação');
    expect(html).not.toContain('&ldquo;');
  });
  it('preserves human insights and readable evidence', () => {
    expect(
      renderToStaticMarkup(
        <InsightValueText
          insight={insight('Cliente perguntou sobre financiamento')}
        />
      )
    ).toContain('Cliente perguntou sobre financiamento');
    expect(
      renderToStaticMarkup(
        <InsightEvidenceText snippet="Consigo financiar dando entrada?" />
      )
    ).toContain('Consigo financiar dando entrada?');
  });
});
