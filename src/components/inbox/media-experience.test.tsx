// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/pt-BR.json';
import { MessageBubble } from './message-bubble';
import type { Message } from '@/types';

function bubble(overrides: Partial<Message> = {}) {
  return <NextIntlClientProvider locale="pt-BR" timeZone="America/Sao_Paulo" messages={messages}>
    <MessageBubble message={{ id: 'm1', conversation_id: 'c1', sender_type: 'customer', content_type: 'text', status: 'delivered', created_at: '2026-10-13T12:00:00Z', ...overrides }} />
  </NextIntlClientProvider>;
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External requests forbidden'); })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Inbox media presentation', () => {
  it('recognizes images already decoded before hydration', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1200);
    render(bubble({ content_type: 'image', media_url: 'https://media.example/cached.jpg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ampliar imagem' }).hasAttribute('disabled')).toBe(false));
  });
  it('recognizes cached native player metadata before hydration', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
    render(bubble({ content_type: 'audio', media_url: 'https://media.example/cached.wav' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
  it('keeps an image loading until the browser decodes it', () => {
    render(bubble({ content_type: 'image', media_url: 'https://media.example/image.jpg' }));
    expect(screen.getByRole('status').textContent).toBe('Carregando imagem');
    expect(screen.getByRole('button', { name: 'Ampliar imagem' }).hasAttribute('disabled')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shows a decoded proportional thumbnail with a keyboard accessible opening control', () => {
    render(bubble({ content_type: 'image', media_url: 'https://media.example/image.jpg' }));
    fireEvent.load(screen.getByAltText('Imagem da conversa'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ampliar imagem' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByAltText('Imagem da conversa').className).toContain('object-contain');
  });
  it('replaces a broken image with a friendly fallback and safe explicit retry', () => {
    render(bubble({ content_type: 'image', media_url: 'https://media.example/image.jpg', content_text: 'Tank preta' }));
    fireEvent.error(screen.getByAltText('Imagem da conversa'));
    expect(screen.getByText('Imagem indisponível')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Tank preta')).toBeTruthy();
  });
  it('opens the existing modal and returns focus after Escape', async () => {
    render(bubble({ content_type: 'image', media_url: 'https://media.example/image.jpg' }));
    fireEvent.load(screen.getByAltText('Imagem da conversa'));
    const trigger = screen.getByRole('button', { name: 'Ampliar imagem' }); trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Visualização da imagem' });
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://media.example/image.jpg');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('closes via the labeled close control', async () => {
    render(bubble({ content_type: 'image', media_url: 'https://media.example/image.jpg' }));
    fireEvent.load(screen.getByAltText('Imagem da conversa')); fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagem' }));
    await screen.findByRole('dialog'); fireEvent.click(screen.getByRole('button', { name: 'Fechar imagem' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('resets image state when a message URL changes', () => {
    const view = render(bubble({ content_type: 'image', media_url: 'https://media.example/old.jpg' }));
    fireEvent.error(screen.getByAltText('Imagem da conversa'));
    view.rerender(bubble({ content_type: 'image', media_url: 'https://media.example/new.jpg' }));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByAltText('Imagem da conversa').getAttribute('src')).toBe('https://media.example/new.jpg');
  });
  it('fetches the existing Meta proxy with cancellation and revokes its object URL', async () => {
    const create = vi.fn(() => 'blob:local-media'); const revoke = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) })));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const view = render(bubble({ content_type: 'image', media_url: '/api/whatsapp/media/123' }));
    await waitFor(() => expect(screen.getByAltText('Imagem da conversa').getAttribute('src')).toBe('blob:local-media'));
    expect(fetch).toHaveBeenCalledWith('/api/whatsapp/media/123', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    view.unmount(); expect(revoke).toHaveBeenCalledWith('blob:local-media');
  });
  it('shows friendly Meta authorization failures without response text or automatic retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    render(bubble({ content_type: 'image', media_url: '/api/whatsapp/media/123' }));
    await screen.findByText('Imagem indisponível'); expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img')).toBeNull();
  });
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//media.example/file', 'https://user:password@media.example/file']) {
    it(`does not expose or fetch unsafe media: ${url.split(':')[0]}`, () => {
      render(bubble({ content_type: 'document', media_url: url }));
      expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText('Documento indisponível')).toBeTruthy();
      expect(fetch).not.toHaveBeenCalled();
    });
  }
  it('renders a supplied document filename and extension without inventing size', () => {
    render(bubble({ content_type: 'document', content_text: 'Proposta Tank.pdf', media_url: 'https://media.example/doc' }));
    expect(screen.getByText('Proposta Tank.pdf')).toBeTruthy(); expect(screen.getByText('PDF')).toBeTruthy();
    const open = screen.getByRole('link', { name: 'Abrir documento' });
    expect(open.getAttribute('target')).toBe('_blank'); expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    expect(document.body.textContent).not.toMatch(/MB|KB/);
  });
  it('uses Documento without metadata and preserves a separate human caption', () => {
    render(bubble({ content_type: 'document', content_text: 'Condições de financiamento', media_url: 'https://media.example/doc' }));
    expect(screen.getByText('Documento')).toBeTruthy(); expect(screen.getByText('Condições de financiamento')).toBeTruthy();
  });
  for (const kind of ['audio', 'video'] as const) {
    it(`uses native ${kind} controls and transitions through loading, ready and error`, () => {
      const view = render(bubble({ content_type: kind, content_text: 'Veja as condições', media_url: 'https://media.example/asset' }));
      const player = view.container.querySelector(kind)!;
      expect(player.hasAttribute('controls')).toBe(true); expect(player.hasAttribute('autoplay')).toBe(false);
      expect(screen.getByRole('status')).toBeTruthy();
      fireEvent.loadedMetadata(player); expect(screen.queryByRole('status')).toBeNull();
      fireEvent.error(player); expect(view.container.querySelector(kind)).toBeNull();
      expect(screen.getByText(kind === 'audio' ? 'Áudio indisponível' : 'Vídeo indisponível')).toBeTruthy();
      expect(screen.getByText('Veja as condições')).toBeTruthy();
    });
  }
  it('linkifies http/https while preserving the exact text, unicode and line breaks', () => {
    const text = 'Olá 👋\nVeja https://example.com/tank?q=preta&x=1. (http://example.com/cores)';
    render(bubble({ content_text: text }));
    const links = screen.getAllByRole('link'); expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://example.com/tank?q=preta&x=1');
    expect(links[1].getAttribute('href')).toBe('http://example.com/cores');
    expect(links[0].parentElement?.textContent).toBe(text);
    for (const link of links) expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
  it('keeps plain text and HTML-looking content inert and exact', () => {
    const text = '<script>alert(1)</script> Olá 😀 +55 13 99779-6070'; render(bubble({ content_text: text }));
    expect(screen.getByText(text).textContent).toBe(text); expect(screen.queryByRole('link')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
  it('neutralizes encoded history and preserves only its human caption', () => {
    render(bubble({ content_type: 'image', content_text: 'Tank preta /9j/' + 'Ab9+/'.repeat(160) }));
    expect(document.body.textContent).not.toContain('/9j/'); expect(screen.getByText('Tank preta')).toBeTruthy();
  });
  it('keeps long content breakable without destructive normalization', () => {
    const text = 'https://example.com/' + 'a'.repeat(600); render(bubble({ content_text: text }));
    expect(screen.getByRole('link').textContent).toBe(text);
    expect(screen.getByRole('link').className).toContain('break-all');
  });
});
