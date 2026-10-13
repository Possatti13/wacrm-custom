import { describe, expect, it } from 'vitest';
import { sortConversationsForDisplay } from './presentation';
const rows = [
  {
    id: 'A',
    last_message_at: null,
    assigned_agent_id: 'owner',
    unread_count: 2,
  },
  {
    id: 'B',
    last_message_at: '2026-10-09T10:00:00Z',
    assigned_agent_id: 'owner',
    unread_count: 1,
  },
  {
    id: 'C',
    last_message_at: '2026-10-11T10:00:00Z',
    assigned_agent_id: 'other',
    unread_count: 4,
  },
];
describe('Inbox presentation order', () => {
  it('places real activity before empty conversations, newest first', () => {
    expect(sortConversationsForDisplay(rows).map((r) => r.id)).toEqual([
      'C',
      'B',
      'A',
    ]);
  });
  it('keeps Mine membership, assignment and unread intact', () => {
    const mine = rows.filter((r) => r.assigned_agent_id === 'owner');
    const sorted = sortConversationsForDisplay(mine, 'mine');
    expect(sorted.map((r) => r.id)).toEqual(['B', 'A']);
    expect(sorted.find((r) => r.id === 'A')).toBe(rows[0]);
    expect(sorted.find((r) => r.id === 'A')?.unread_count).toBe(2);
    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });
  it('preserves the existing Priority order', () => {
    expect(sortConversationsForDisplay(rows, 'priority')).toEqual(rows);
  });
  it('retains search/filter membership', () => {
    const filtered = rows.filter((r) => r.id !== 'B');
    expect(sortConversationsForDisplay(filtered).map((r) => r.id)).toEqual([
      'C',
      'A',
    ]);
  });
  it('uses stable ID ascending for equal activity and two nulls', () => {
    const tied = [
      { id: 'z', last_message_at: null },
      { id: 'b', last_message_at: '2026-10-11T10:00:00Z' },
      { id: 'a', last_message_at: '2026-10-11T10:00:00Z' },
      { id: 'c', last_message_at: null },
    ];
    expect(sortConversationsForDisplay(tied).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
      'z',
    ]);
    expect(
      sortConversationsForDisplay([...tied].reverse()).map((r) => r.id)
    ).toEqual(['a', 'b', 'c', 'z']);
  });
  it('treats missing/invalid dates as no activity', () => {
    expect(
      sortConversationsForDisplay([
        { id: 'z', last_message_at: 'invalid' },
        { id: 'b' },
        { id: 'a', last_message_at: '2026-10-11T10:00:00Z' },
      ]).map((r) => r.id)
    ).toEqual(['a', 'b', 'z']);
  });
});
