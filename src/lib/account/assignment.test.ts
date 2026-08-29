import { describe, it, expect, vi } from 'vitest';
import {
  assignConversationAtomic,
  fetchAssignmentHistory,
  AssignmentConcurrencyError,
  AssignmentError,
} from './assignment';

describe('assignConversationAtomic', () => {
  it('calls RPC with correct parameters and returns assignment details on success', () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        conversation_id: 'conv-123',
        previous_agent_id: null,
        assigned_agent_id: 'user-456',
        event_type: 'claimed',
        history_id: 'hist-789',
      },
      error: null,
    });

    const mockDb = { rpc: mockRpc } as any;

    return assignConversationAtomic(mockDb, {
      accountId: 'acc-1',
      conversationId: 'conv-123',
      targetUserId: 'user-456',
      reason: 'Claiming thread',
      expectedCurrentAgentId: null,
    }).then((res) => {
      expect(mockRpc).toHaveBeenCalledWith('assign_conversation_atomic', {
        p_account_id: 'acc-1',
        p_conversation_id: 'conv-123',
        p_target_user_id: 'user-456',
        p_reason: 'Claiming thread',
        p_expected_current_agent_id: null,
        p_force: false,
      });
      expect(res).toEqual({
        success: true,
        conversationId: 'conv-123',
        previousAgentId: null,
        assignedAgentId: 'user-456',
        eventType: 'claimed',
        historyId: 'hist-789',
        noOp: undefined,
      });
    });
  });

  it('throws AssignmentConcurrencyError when RPC returns CONCURRENCY_CONFLICT', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        error: 'CONCURRENCY_CONFLICT',
        message: 'Conversation assignment was modified by another operator.',
        current_assigned_agent_id: 'user-other',
      },
      error: null,
    });

    const mockDb = { rpc: mockRpc } as any;

    await expect(
      assignConversationAtomic(mockDb, {
        accountId: 'acc-1',
        conversationId: 'conv-123',
        targetUserId: 'user-456',
        expectedCurrentAgentId: 'user-previous',
      })
    ).rejects.toThrow(AssignmentConcurrencyError);
  });

  it('handles database error codes properly (Forbidden / Not Found)', async () => {
    const mockRpcForbidden = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Forbidden: caller is not a member of this account' },
    });

    const mockDb = { rpc: mockRpcForbidden } as any;

    await expect(
      assignConversationAtomic(mockDb, {
        accountId: 'acc-1',
        conversationId: 'conv-123',
        targetUserId: 'user-456',
      })
    ).rejects.toThrow(AssignmentError);
  });
});

describe('fetchAssignmentHistory', () => {
  it('loads assignment events and hydrates member profiles', async () => {
    const historyRows = [
      {
        id: 'h1',
        account_id: 'acc-1',
        conversation_id: 'conv-1',
        assigned_by_user_id: 'u1',
        from_user_id: null,
        to_user_id: 'u2',
        event_type: 'assigned',
        reason: 'Initial assignment',
        created_at: '2026-08-29T10:00:00Z',
      },
    ];

    const profilesRows = [
      { id: 'p1', user_id: 'u1', full_name: 'Manager Alice', email: 'alice@test.com', avatar_url: null },
      { id: 'p2', user_id: 'u2', full_name: 'Seller Bob', email: 'bob@test.com', avatar_url: null },
    ];

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'conversation_assignment_history') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: historyRows, error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: profilesRows, error: null }),
          };
        }
        return {} as any;
      }),
    } as any;

    const result = await fetchAssignmentHistory(mockDb, 'acc-1', 'conv-1');

    expect(result).toHaveLength(1);
    expect(result[0].assigned_by?.full_name).toBe('Manager Alice');
    expect(result[0].to_user?.full_name).toBe('Seller Bob');
    expect(result[0].from_user).toBeNull();
    expect(result[0].event_type).toBe('assigned');
  });
});
