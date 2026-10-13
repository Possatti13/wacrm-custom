import type { Message } from '@/types';
const deliveryOrder = { sending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };
export function mergeIncomingMessage(current: Message[], incoming: Message): Message[] {
  const existing = current.find(m => m.id === incoming.id);
  if (existing) {
    const status = incoming.status !== 'failed' && deliveryOrder[existing.status] > deliveryOrder[incoming.status]
      ? existing.status : incoming.status;
    return current.map(m => m.id === incoming.id ? { ...m, ...incoming, status } : m);
  }
  return [...current, incoming];
}
export function reconcileSentMessage(current: Message[], id: string, updates: Partial<Message>): Message[] {
  const persisted = updates.id && updates.id !== id ? current.find(m => m.id === updates.id) : undefined;
  // Only the POST's returned UUID establishes identity. Never guess by text/time.
  return current.flatMap(m => {
    if (m.id === id) {
      const status = persisted?.status === 'read' || persisted?.status === 'delivered'
        ? persisted.status : updates.status ?? persisted?.status ?? m.status;
      return [{ ...m, ...persisted, ...updates, status }];
    }
    return persisted && m.id === persisted.id && current.some(row => row.id === id) ? [] : [m];
  });
}
export function mergeMessageSnapshot(current: Message[], loaded: Message[], before: Message[]): Message[] {
  const atStart = new Map(before.map(m => [m.id, m]));
  const merged = new Map(loaded.map(m => [m.id, m]));
  // Keep local sends and events received while the snapshot was in flight.
  for (const m of current) {
    if (m.id.startsWith('temp-') || atStart.get(m.id) !== m) merged.set(m.id, m);
  }
  return [...merged.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
