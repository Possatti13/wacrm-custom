import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listTasks, getTaskById, createTask, updateTask, deleteTask } from './repository';

describe('Tasks Repository', () => {
  const accountId = '00000000-0000-0000-0000-000000000001';
  const taskId = '00000000-0000-0000-0000-000000000099';
  const userId = '00000000-0000-0000-0000-000000000111';
  const profileId = '00000000-0000-0000-0000-000000000222';

  it('lists tasks with multi-tenant filtering and null assignee', async () => {
    const mockTasks = [
      { id: taskId, account_id: accountId, title: 'Follow-up proposal', status: 'pending', assigned_user_id: null },
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
    expect(result[0].assigned_user).toBeNull();
    expect(mockDb.from).toHaveBeenCalledWith('tasks');
  });

  it('enriches tasks with matching assigned user profile within same account', async () => {
    const mockTasks = [
      { id: taskId, account_id: accountId, title: 'Task with Assignee', status: 'pending', assigned_user_id: userId },
    ];
    const mockProfiles = [
      { id: profileId, user_id: userId, full_name: 'Carlos Consultor', email: 'carlos@empresa.com', avatar_url: null },
    ];

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockTasks, error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: mockProfiles, error: null }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const result = await listTasks(mockDb, accountId);
    expect(result).toHaveLength(1);
    expect(result[0].assigned_user).toEqual({
      id: profileId,
      full_name: 'Carlos Consultor',
      email: 'carlos@empresa.com',
      avatar_url: null,
    });
  });

  it('guarantees cross-tenant isolation when resolving profiles', async () => {
    const mockTasks = [
      { id: taskId, account_id: accountId, title: 'Task in Tenant A', status: 'pending', assigned_user_id: 'user-tenant-b' },
    ];

    // Profiles query for Tenant A returns empty because the user belongs to Tenant B
    const mockProfilesInTenantA: Array<{ id: string; user_id: string; full_name: string; email: string | null; avatar_url: string | null }> = [];

    const mockProfileEq = vi.fn().mockReturnThis();
    const mockProfileIn = vi.fn().mockResolvedValue({ data: mockProfilesInTenantA, error: null });

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockTasks, error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: mockProfileEq.mockReturnValue({
              in: mockProfileIn,
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const result = await listTasks(mockDb, accountId);
    expect(result).toHaveLength(1);
    // User from other tenant cannot be resolved in Tenant A's profile space
    expect(result[0].assigned_user).toBeNull();
    expect(mockProfileEq).toHaveBeenCalledWith('account_id', accountId);
  });

  it('gets task by ID and enriches profile', async () => {
    const mockTask = {
      id: taskId,
      account_id: accountId,
      title: 'Detailed Task',
      status: 'pending',
      assigned_user_id: userId,
    };
    const mockProfiles = [
      { id: profileId, user_id: userId, full_name: 'Ana Vendas', email: 'ana@empresa.com', avatar_url: null },
    ];

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockTask, error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: mockProfiles, error: null }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const result = await getTaskById(mockDb, accountId, taskId);
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Detailed Task');
    expect(result?.assigned_user?.full_name).toBe('Ana Vendas');
  });

  it('creates task with AI suggestion provenance', async () => {
    const mockCreated = {
      id: taskId,
      account_id: accountId,
      title: 'Ligar para confirmar visita',
      priority: 'high',
      source: 'intelligence',
      assigned_user_id: null,
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
      assigned_user_id: null,
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
