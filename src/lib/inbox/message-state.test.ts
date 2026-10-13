import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { mergeIncomingMessage, reconcileSentMessage, mergeMessageSnapshot } from './message-state';

const row = (id: string, changes: Partial<Message> = {}): Message => ({ id, conversation_id: 'A', sender_type: 'agent', content_type: 'text', content_text: 'Olá', status: 'sending', created_at: '2026-10-13T12:00:00Z', ...changes });
describe('Inbox message identities', () => {
  it('keeps both pending outbounds when an inbound arrives', () => {
    expect(mergeIncomingMessage([row('temp-1'), row('temp-2')], row('inbound', { sender_type: 'customer' })).map(m => m.id)).toEqual(['temp-1', 'temp-2', 'inbound']);
  });
  it('only reconciles the exact acknowledged outbound, including realtime arriving first', () => {
    const rows = mergeIncomingMessage([row('temp-1'), row('temp-2')], row('persisted', { status: 'read' }));
    const result = reconcileSentMessage(rows, 'temp-1', { id: 'persisted', message_id: 'wa-1', status: 'sent' });
    expect(result.map(m => m.id)).toEqual(['persisted', 'temp-2']);
    expect(result[0].status).toBe('read');
  });
  it('reconciles confirmation before realtime without duplicating the bubble', () => {
    const rows = reconcileSentMessage([row('temp-1')], 'temp-1', { id: 'persisted', status: 'sent' });
    expect(mergeIncomingMessage(rows, row('persisted', { status: 'delivered' }))).toEqual([row('persisted', { status: 'delivered' })]);
  });
  it('does not regress delivery when an older INSERT arrives after the POST or status event', () => {
    const rows = [row('persisted', { status: 'read' })];
    expect(mergeIncomingMessage(rows, row('persisted')).at(0)?.status).toBe('read');
  });
  it('retains failed sends and unrelated pending messages', () => {
    const rows = reconcileSentMessage([row('temp-1'), row('temp-2')], 'temp-1', { status: 'failed' });
    expect(rows.map(m => m.status)).toEqual(['failed', 'sending']);
    expect(mergeMessageSnapshot(rows, [], rows).map(m => m.id)).toEqual(['temp-1', 'temp-2']);
  });
  it('keeps a pending send across refetch', () => {
    expect(mergeMessageSnapshot([row('old'), row('temp-1')], [row('old')], [row('old')]).map(m => m.id)).toEqual(['old', 'temp-1']);
  });
  it('does not roll back realtime inserts/status changes received during a refetch', () => {
    const before = [row('old')];
    const current = [row('old', { status: 'read' }), row('new')];
    expect(mergeMessageSnapshot(current, before, before)).toEqual(current);
  });
  it('allows an authoritative refetch to remove an old persisted row', () => {
    const before = [row('old')];
    expect(mergeMessageSnapshot(before, [], before)).toEqual([]);
  });
});
