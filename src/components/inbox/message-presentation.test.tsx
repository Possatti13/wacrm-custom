import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/pt-BR.json';
import { MessageBubble } from './message-bubble';
import type { Message } from '@/types';

const binary = '/9j/4AAQSkZJRgABAQAAAQABAAD' + 'Ab9+/'.repeat(160);
const message = (overrides: Partial<Message>): Message => ({
  id: 'message',
  conversation_id: 'conversation',
  content_type: 'text',
  sender_type: 'customer',
  status: 'delivered',
  created_at: '2026-10-09T10:00:00Z',
  ...overrides,
});
const render = (
  msg: Message,
  reply?: { authorLabel: string; preview: string }
) =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      timeZone="America/Sao_Paulo"
      messages={messages}
    >
      <MessageBubble message={msg} reply={reply} />
    </NextIntlClientProvider>
  );

describe('MessageBubble actual rendered surfaces', () => {
  it('does not render legacy binary text in a bubble', () => {
    const html = render(message({ content_text: binary }));
    expect(html).not.toContain('/9j/');
    expect(html).toContain('Conteúdo de mídia não exibido');
  });
  it('does not render encoded image captions', () => {
    expect(
      render(message({ content_type: 'image', content_text: binary }))
    ).not.toContain('/9j/');
  });
  it('keeps the real human caption', () => {
    expect(
      render(
        message({
          content_type: 'image',
          content_text: 'Tank preta pronta entrega',
        })
      )
    ).toContain('Tank preta pronta entrega');
  });
  it('keeps recoverable video/audio/document assets', () => {
    for (const content_type of ['video', 'audio', 'document'] as const) {
      const html = render(
        message({
          content_type,
          content_text: binary,
          media_url: 'https://media.example/asset?signature=123',
        })
      );
      expect(html).toContain('https://media.example/asset?signature=123');
      expect(html).not.toContain('/9j/');
    }
  });
  it('protects quoted history as well as the current message', () => {
    expect(
      render(message({ content_text: 'Sim, essa cor' }), {
        authorLabel: 'Cliente',
        preview: binary,
      })
    ).not.toContain('/9j/');
  });
});
