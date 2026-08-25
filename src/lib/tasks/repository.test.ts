import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listTasks, createTask, updateTask, deleteTask } from './repository';

describe('Tasks Repository', () => {
  const accountId = '00000000-0000-0000-0000-000000000001';
  const taskId = '00000000-0000-0000-0000-000000000099';

  it('lists tasks with multi-tenant filtering', async () => {
    const mockTasks = [
      { id: taskId, account_id: accountId, title: 'Follow-up proposal', status: 'pending' },
    ];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockTasks, error: null });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        eq: mockEq,
        order: mockOrder,
      }),
    } as unknown as SupabaseClient;

    const result = await listTasks(mockDb, accountId);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Follow-up proposal');
    expect(mockDb.from).toHaveBeenCalledWith('tasks');
  });

  it('creates task with AI suggestion provenance', async () => {
    const mockCreated = {
      id: taskId,
      account_id: accountId,
      title: 'Ligar para confirmar visita',
      priority: 'high',
      source: 'intelligence',
      ai_suggestion_provenance: {
        insight_id: 'ins-123',
        suggested_action: 'Ligar para confirmar visita',
      },
    };

    const mockInsert = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: mockCreated, error: null });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        insert: mockInsert,
        select: mockSelect,
        single: mockSingle,
      }),
    } as unknown as SupabaseClient;

    const task = await createTask(mockDb, accountId, {
      title: 'Ligar para confirmar visita',
      priority: 'high',
      source: 'intelligence',
      ai_suggestion_provenance: {
        insight_id: 'ins-123',
        suggested_action: 'Ligar para confirmar visita',
      },
    });

    expect(task.title).toBe('Ligar para confirmar visita');
    expect(task.source).toBe('intelligence');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: accountId,
        title: 'Ligar para confirmar visita',
        priority: 'high',
        source: 'intelligence',
      })
    );
  });

  it('updates task status to completed and sets completed_at timestamp', async () => {
    const mockUpdated = {
      id: taskId,
      account_id: accountId,
      status: 'completed',
      completed_at: new Date().toISOString(),
    };

    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq1 = vi.fn().mockReturnThis();
    const mockEq2 = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: mockUpdated, error: null });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
        eq: mockEq1.mockImplementation(() => ({
          eq: mockEq2.mockReturnValue({
            select: mockSelect.mockReturnValue({
              single: mockSingle,
            }),
          }),
        })),
      }),
    } as unknown as SupabaseClient;

    const updated = await updateTask(mockDb, accountId, taskId, {
      status: 'completed',
    });

    expect(updated.status).toBe('completed');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(String),
      })
    );
  });

  it('deletes a task', async () => {
    const mockDelete = vi.fn().mockReturnThis();
    const mockEq1 = vi.fn().mockReturnThis();
    const mockEq2 = vi.fn().mockResolvedValue({ error: null });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        delete: mockDelete,
        eq: mockEq1.mockImplementation(() => ({
          eq: mockEq2,
        })),
      }),
    } as unknown as SupabaseClient;

    const ok = await deleteTask(mockDb, accountId, taskId);
    expect(ok).toBe(true);
  });
});
