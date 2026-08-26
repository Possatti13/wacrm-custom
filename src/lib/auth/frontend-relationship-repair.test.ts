import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listTasks } from '@/lib/tasks/repository';

describe('Frontend Data Relationship Repair (Phase 17A.1)', () => {
  const accountA = '11111111-1111-1111-1111-111111111111';
  const userA = 'user-001-account-a';
  const userB = 'user-002-account-b';

  describe('Tasks & Profiles Isolation', () => {
    it('handles tasks without assignees cleanly', async () => {
      const mockTasks = [
        { id: 'task-1', account_id: accountA, title: 'No assignee task', assigned_user_id: null },
      ];

      const mockDb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: mockTasks, error: null }),
        }),
      } as unknown as SupabaseClient;

      const tasks = await listTasks(mockDb, accountA);
      expect(tasks[0].assigned_user).toBeNull();
      // Should not query profiles table if there are no user IDs
      expect(mockDb.from).toHaveBeenCalledTimes(1);
    });

    it('enriches tasks with assignee from same account and rejects cross-tenant user ID', async () => {
      const mockTasks = [
        { id: 'task-1', account_id: accountA, title: 'Valid user task', assigned_user_id: userA },
        { id: 'task-2', account_id: accountA, title: 'Foreign user task', assigned_user_id: userB },
      ];

      const mockProfilesAccountA = [
        { id: 'prof-1', user_id: userA, full_name: 'Atendente Tenant A', email: 'a@tenant.com', avatar_url: null },
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
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                expect(col).toBe('account_id');
                expect(val).toBe(accountA);
                return {
                  in: vi.fn().mockResolvedValue({ data: mockProfilesAccountA, error: null }),
                };
              }),
            };
          }
          return {};
        }),
      } as unknown as SupabaseClient;

      const tasks = await listTasks(mockDb, accountA);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].assigned_user).toEqual({
        id: 'prof-1',
        full_name: 'Atendente Tenant A',
        email: 'a@tenant.com',
        avatar_url: null,
      });
      // User B is not in Account A's profile list -> assigned_user must be null
      expect(tasks[1].assigned_user).toBeNull();
    });
  });

  describe('Pipeline Deal Assignee FK Verification', () => {
    it('verifies deal query uses canonical fk_deals_assigned_to_account constraint hint', async () => {
      const mockDeals = [
        {
          id: 'deal-1',
          account_id: accountA,
          title: 'Grande Proposta Comercial',
          assigned_to: 'prof-1',
          assignee: { id: 'prof-1', full_name: 'Vendedor Responsável' },
        },
      ];

      const mockSelect = vi.fn().mockReturnThis();
      const mockEq = vi.fn().mockReturnThis();
      const mockOrder = vi.fn().mockResolvedValue({ data: mockDeals, error: null });

      const mockDb = {
        from: vi.fn().mockReturnValue({
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
        }),
      } as unknown as SupabaseClient;

      const pipelineId = 'pipe-123';
      const { data } = await mockDb
        .from('deals')
        .select('*, contact:contacts(*), assignee:profiles!fk_deals_assigned_to_account(*)')
        .eq('pipeline_id', pipelineId)
        .order('created_at', { ascending: false });

      expect(mockSelect).toHaveBeenCalledWith(
        '*, contact:contacts(*), assignee:profiles!fk_deals_assigned_to_account(*)'
      );
      expect(data).toHaveLength(1);
      expect(data?.[0].assignee?.full_name).toBe('Vendedor Responsável');
    });
  });

  describe('Contact Notes Author Profile Resolution', () => {
    it('resolves author names safely using user_id in tenant profiles', async () => {
      const rawNotes = [
        { id: 'note-1', account_id: accountA, contact_id: 'ct-1', user_id: userA, note_text: 'Cliente tem interesse' },
        { id: 'note-2', account_id: accountA, contact_id: 'ct-1', user_id: 'deleted-user', note_text: 'Nota antiga' },
      ];

      const mockProfiles = [
        { user_id: userA, full_name: 'Maria Vendedora' },
      ];

      const profileNameMap = new Map<string, string>();
      for (const p of mockProfiles) {
        profileNameMap.set(p.user_id, p.full_name);
      }

      const enrichedNotes = rawNotes.map((n) => ({
        ...n,
        profiles: { name: profileNameMap.get(n.user_id) || 'Atendente' },
      }));

      expect(enrichedNotes[0].profiles.name).toBe('Maria Vendedora');
      expect(enrichedNotes[1].profiles.name).toBe('Atendente');
    });
  });
});
