export function sortConversationsForDisplay<
  T extends { id: string; last_message_at?: string | null },
>(rows: readonly T[], segment: 'all' | 'mine' | 'priority' = 'all'): T[] {
  // Priority keeps its existing commercial presentation order and membership.
  if (segment === 'priority') return [...rows];
  const activity = (row: T) => {
    const value = row.last_message_at ? Date.parse(row.last_message_at) : NaN;
    return Number.isFinite(value) ? value : -Infinity;
  };
  return [...rows].sort((a, b) => {
    const left = activity(a);
    const right = activity(b);
    if (left !== right) return left > right ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
