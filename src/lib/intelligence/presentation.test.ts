import { describe, expect, it } from 'vitest';
import {
  getHistoricalTextPresentation,
  getInsightPresentation,
} from './presentation';

const fallback = 'Registro histórico indisponível para apresentação';
describe('Historical intelligence — presentation only', () => {
  it.each([
    'O cliente enviou dados binários corrompidos em base64',
    'A conversation took place, but the messages contain binary/image encoding data rather than readable text, preventing commercial extraction.',
    'Desconsiderar mensagem corrompida ou solicitar reenvio do arquivo.',
    'Falha no processamento do payload JSON recebido pelo webhook WAHA.',
    'Provider error: invalid payload; extraction failed.',
    '/9j/4AAQSkZJRgABAQAAAQABAAD' + 'Ab9+/'.repeat(100),
  ])('marks a diagnostic as unavailable, not a commercial fact', (text) => {
    expect(getHistoricalTextPresentation(text)).toEqual({
      text: fallback,
      available: false,
    });
  });

  it.each([
    'Cliente perguntou sobre financiamento',
    'Solicitou o produto SKU JSON-2026',
    'Cliente quer treinamento de JSON',
    'Cliente perguntou pelo produto Binary',
  ])('preserves a legitimate insight: %s', (text) => {
    expect(getHistoricalTextPresentation(text)).toEqual({
      text,
      available: true,
    });
  });

  it('does not authorize a factual card with unusable evidence', () => {
    const insight = Object.freeze({
      value_text: 'Cliente perguntou sobre financiamento',
      evidence: [
        { snippet: 'data:image/png;base64,iVBORw0KGgo' + 'Ab9+/'.repeat(100) },
      ],
      id: 'original',
      source: 'intelligence',
      version: 'v1',
    });
    expect(getInsightPresentation(insight)).toEqual({
      text: fallback,
      available: false,
    });
    expect(insight.value_text).toBe('Cliente perguntou sobre financiamento');
    expect(insight.id).toBe('original');
    expect(insight.source).toBe('intelligence');
    expect(insight.version).toBe('v1');
  });
});
