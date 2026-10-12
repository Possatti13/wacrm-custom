import { describe, expect, it } from 'vitest';
import { getMessagePresentation, isTechnicalContent } from './presentation';

const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD' + 'Ab9+/'.repeat(300);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAUA' + 'Ab9+/'.repeat(300);

describe('Message display — safe persisted content', () => {
  it.each([
    'Olá, tenho interesse na Tank preta',
    'Pedido ABCD123456',
    'SKU TANK-BLK-2026 — entrada R$ 3.000',
    'CPF 123.456.789-09 / CNPJ 12.345.678/0001-90',
    'Placa ABC1D23, hash 7fa34e9801b76ced',
    'Código ' + 'ABCD1234'.repeat(160),
    'https://loja.example/item?token=' + 'Ab9+/'.repeat(200),
    '{"pedido":"ABCD123456","cores":["preta","branca"]}',
    'Tenho interesse em treinamento de JSON para minha equipe.',
    'Gostaria de confirmar as cores e as condições de financiamento. '.repeat(
      100
    ),
  ])('preserves legitimate human/commercial text: %s', (text) => {
    expect(
      getMessagePresentation({ content_type: 'text', content_text: text }).text
    ).toBe(text);
    expect(isTechnicalContent(text)).toBe(false);
  });

  it.each([
    jpeg,
    png,
    '/9j/4AAQSkZJRgABAQAAAQABAAD...',
    'data:image/png;base64,' + png,
    btoa('\u0000\u00ff\u0012\u0080'.repeat(400)),
    String.raw`\xff\xd8\xff\xe0\x00\x10\x4a\x46\x49\x46\x00\x01`,
    JSON.stringify({
      type: 'Buffer',
      data: Array.from({ length: 40 }, (_, i) => i),
    }),
  ])(
    'replaces unequivocal encoded content even in legacy text',
    (content_text) => {
      const input = Object.freeze({ content_type: 'text', content_text });
      expect(getMessagePresentation(input).text).toBe(
        'Conteúdo de mídia não exibido'
      );
      expect(getMessagePresentation(input).isTechnical).toBe(true);
      expect(input.content_text).toBe(content_text);
    }
  );

  it.each([
    ['image', 'Imagem enviada'],
    ['audio', 'Áudio enviado'],
    ['video', 'Vídeo enviado'],
    ['document', 'Documento enviado'],
    ['sticker', 'Sticker enviado'],
  ])('labels %s without exposing technical captions', (content_type, label) => {
    const result = getMessagePresentation({ content_type, content_text: jpeg });
    expect(result.text).toBe(label);
    expect(result.caption).toBeNull();
    expect(result.mediaLabel).toBe(label);
  });

  it('preserves a real image caption and the same preview interpretation', () => {
    const result = getMessagePresentation({
      content_type: 'image',
      content_text: 'Tank preta pronta entrega',
    });
    expect(result.text).toBe('Imagem enviada — Tank preta pronta entrega');
    expect(result.caption).toBe('Tank preta pronta entrega');
  });

  it('preserves readable text alongside an encoded block', () => {
    const result = getMessagePresentation({
      content_type: 'image',
      content_text: 'Cores disponíveis\n' + jpeg,
    });
    expect(result.text).toBe('Imagem enviada — Cores disponíveis');
    expect(result.caption).toBe('Cores disponíveis');
    expect(result.isTechnical).toBe(true);
  });

  it('does not modify media references or persistence fields', () => {
    const message = Object.freeze({
      content_type: 'image',
      content_text: jpeg,
      media_url: '/api/whatsapp/media/asset',
      id: 'original',
    });
    getMessagePresentation(message);
    expect(message.media_url).toBe('/api/whatsapp/media/asset');
    expect(message.id).toBe('original');
    expect(message.content_text).toBe(jpeg);
  });

  it('does not expose a technical media envelope as readable JSON', () => {
    const content_text = JSON.stringify({ mimetype: 'image/jpeg', data: jpeg });
    expect(
      getMessagePresentation({ content_type: 'text', content_text }).text
    ).toBe('Conteúdo de mídia não exibido');
  });
});
