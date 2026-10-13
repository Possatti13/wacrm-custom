// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './message-composer';
import { uploadAccountMedia, deleteAccountMedia } from '@/lib/storage/upload-media';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/hooks/use-can', () => ({ useCan: () => true }));
vi.mock('./quick-reply-picker', () => ({ QuickReplyPicker: () => null }));
vi.mock('@/lib/storage/upload-media', () => ({ uploadAccountMedia: vi.fn(), deleteAccountMedia: vi.fn(), MEDIA_MAX_BYTES_BY_KIND: {} }));
afterEach(cleanup);
const props = { sessionExpired: false, onSend: vi.fn(), onSendMedia: vi.fn(), onSendInteractive: vi.fn(), onOpenTemplates: vi.fn() };
describe('real composer conversation boundaries', () => {
  it('does not reapply an old Copilot prefill over a manually edited draft on return', () => {
    const { rerender } = render(<MessageComposer {...props} conversationId="A" prefilledText="Sugestão" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Editado' } });
    rerender(<MessageComposer {...props} conversationId="B" />);
    rerender(<MessageComposer {...props} conversationId="A" prefilledText="Sugestão" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Editado');
  });
  it('keeps a failed attachment and never deletes a possibly delivered upload', async () => {
    vi.mocked(uploadAccountMedia).mockResolvedValue({ publicUrl: '/attachment.png', path: 'account/attachment.png' });
    const onSendMedia = vi.fn().mockRejectedValue(new Error('Network interruption'));
    const { container, rerender, unmount } = render(<MessageComposer {...props} onSendMedia={onSendMedia} conversationId="A" />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'attachment.png', { type: 'image/png' })] } });
    await screen.findByAltText('attachment.png');
    await act(async () => fireEvent.keyDown(screen.getByPlaceholderText('addCaption'), { key: 'Enter' }));
    expect(screen.getByRole('alert').textContent).toContain('anexo foi preservado');
    expect(screen.getByAltText('attachment.png')).toBeDefined();
    rerender(<MessageComposer {...props} onSendMedia={onSendMedia} conversationId="B" />);
    expect(screen.queryByAltText('attachment.png')).toBeNull();
    rerender(<MessageComposer {...props} onSendMedia={onSendMedia} conversationId="A" />);
    expect(screen.getByAltText('attachment.png')).toBeDefined();
    unmount();
    expect(deleteAccountMedia).not.toHaveBeenCalled();
    expect(onSendMedia).toHaveBeenCalledTimes(1);
  });
  it('keeps an unsent text draft in A and restores it after visiting B', () => {
    const { rerender } = render(<MessageComposer {...props} conversationId="A" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A draft' } });
    rerender(<MessageComposer {...props} conversationId="B" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B draft' } });
    rerender(<MessageComposer {...props} conversationId="A" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('A draft');
  });
  it('a failed send after switching restores only A and does not erase B', async () => {
    let reject!: (reason: Error) => void;
    const onSend = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const { rerender } = render(<MessageComposer {...props} onSend={onSend} conversationId="A" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A message' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    rerender(<MessageComposer {...props} onSend={onSend} conversationId="B" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B draft' } });
    await act(async () => reject(new Error('Offline')));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('B draft');
    rerender(<MessageComposer {...props} onSend={onSend} conversationId="A" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('A message');
    expect(screen.getByRole('alert').textContent).toContain('confirmação');
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
