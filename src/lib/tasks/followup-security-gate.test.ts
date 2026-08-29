/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

const scratchRequire = createRequire(
  path.join(
    process.env.USERPROFILE || 'C:\\Users\\leopo',
    '.gemini',
    'antigravity',
    'brain',
    '7dd65584-91ac-45ad-828c-ba770c616490',
    'scratch',
    'package.json'
  )
);
const { PGlite } = scratchRequire('@electric-sql/pglite');

describe('CICLOPES V1.2.1 — Follow-up Security & Migration Integrity Gate', () => {
  let pg: any;

  const accountA = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
  const accountB = '99999999-9999-4999-9999-999999999999';

  const ownerA = '00000000-0000-4000-0000-000000000001';
  const sellerA = 'a1111111-1111-4111-a111-111111111111';
  const sellerB = 'b2222222-2222-4222-b222-222222222222';
  const viewerA = '33333333-3333-4333-3333-333333333333';

  const contactA = '463eb74e-8b05-4c88-b096-dd9acac31f80';
  const convA = 'ff38fefd-667a-472f-b9c2-4470c896fb00';
  const dealA = '77777777-7777-4777-7777-777777777777';

  let taskSellerAId: string;
  let taskSellerBId: string;

  beforeEach(async () => {
    pg = new PGlite();

    await pg.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;

      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY,
        email TEXT
      );

      CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');

      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        seller_conversation_visibility TEXT NOT NULL DEFAULT 'all'
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        account_id UUID NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        account_role account_role_enum DEFAULT 'agent'
      );

      CREATE OR REPLACE FUNCTION is_account_member(p_account_id uuid, p_min_role account_role_enum DEFAULT 'viewer'::account_role_enum)
      RETURNS boolean AS $$
      DECLARE
        v_role account_role_enum;
      BEGIN
        SELECT account_role INTO v_role
        FROM profiles
        WHERE account_id = p_account_id AND user_id = auth.uid();

        IF v_role IS NULL THEN RETURN false; END IF;
        IF p_min_role = 'viewer' THEN RETURN true; END IF;
        IF p_min_role = 'agent' THEN RETURN v_role IN ('owner', 'admin', 'agent'); END IF;
        IF p_min_role = 'admin' THEN RETURN v_role IN ('owner', 'admin'); END IF;
        IF p_min_role = 'owner' THEN RETURN v_role = 'owner'; END IF;
        RETURN false;
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        user_id UUID,
        phone TEXT,
        whatsapp_lid TEXT,
        name TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        user_id UUID,
        contact_id UUID NOT NULL REFERENCES contacts(id),
        external_chat_id TEXT,
        status TEXT DEFAULT 'open',
        assigned_agent_id UUID,
        last_customer_message_at TIMESTAMPTZ,
        last_agent_message_at TIMESTAMPTZ,
        unattended_since TIMESTAMPTZ,
        last_message_text TEXT,
        last_message_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (account_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        contact_id UUID NOT NULL REFERENCES contacts(id),
        title TEXT NOT NULL,
        value NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS contact_lead_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        contact_id UUID NOT NULL UNIQUE REFERENCES contacts(id),
        current_intent TEXT,
        urgency TEXT,
        next_action TEXT,
        next_action_due_at TIMESTAMPTZ,
        next_action_source TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS contact_lead_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        contact_id UUID NOT NULL UNIQUE REFERENCES contacts(id),
        score INTEGER DEFAULT 0,
        calculated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
        conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
        deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
        assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        completed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'pending',
        action_type TEXT NOT NULL DEFAULT 'other',
        waiting_on TEXT,
        due_at TIMESTAMPTZ,
        original_due_at TIMESTAMPTZ,
        snoozed_until TIMESTAMPTZ,
        snooze_count INTEGER NOT NULL DEFAULT 0,
        snooze_reason TEXT,
        completed_at TIMESTAMPTZ,
        source TEXT NOT NULL DEFAULT 'manual',
        ai_suggestion_provenance JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Functions from Migration 074
      CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz TEXT)
      RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
      BEGIN
        IF tz IS NULL OR trim(tz) = '' THEN RETURN FALSE; END IF;
        PERFORM now() AT TIME ZONE tz;
        RETURN TRUE;
      EXCEPTION WHEN OTHERS THEN RETURN FALSE;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.guard_tasks_lifecycle_updates()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE
        v_jwt_role TEXT;
        v_caller_id UUID;
      BEGIN
        v_caller_id := auth.uid();
        v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

        IF v_caller_id IS NOT NULL AND v_jwt_role <> 'service_role' THEN
          IF current_setting('ciclopes.allow_task_lifecycle_update', true) IS DISTINCT FROM 'on' THEN
            IF (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed')
               OR (OLD.completed_at IS DISTINCT FROM NEW.completed_at AND NEW.completed_at IS NOT NULL) THEN
              RAISE EXCEPTION 'Direct completion of task is forbidden. Use complete_followup_atomic procedure.' USING ERRCODE = '42501';
            END IF;

            IF OLD.completed_by_user_id IS DISTINCT FROM NEW.completed_by_user_id THEN
              RAISE EXCEPTION 'Direct update of completed_by_user_id is forbidden. Use complete_followup_atomic procedure.' USING ERRCODE = '42501';
            END IF;

            IF (OLD.snoozed_until IS DISTINCT FROM NEW.snoozed_until)
               OR (OLD.snooze_count IS DISTINCT FROM NEW.snooze_count) THEN
              RAISE EXCEPTION 'Direct snooze of task is forbidden. Use snooze_followup_atomic procedure.' USING ERRCODE = '42501';
            END IF;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS trg_guard_tasks_lifecycle ON public.tasks;
      CREATE TRIGGER trg_guard_tasks_lifecycle
        BEFORE UPDATE ON public.tasks
        FOR EACH ROW
        EXECUTE FUNCTION public.guard_tasks_lifecycle_updates();

      CREATE OR REPLACE FUNCTION public.snooze_followup_atomic(
        p_account_id UUID,
        p_task_id UUID,
        p_snooze_until TIMESTAMPTZ,
        p_reason TEXT DEFAULT NULL
      )
      RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE
        v_caller_id UUID;
        v_caller_role account_role_enum;
        v_jwt_role TEXT;
        v_task RECORD;
        v_updated RECORD;
      BEGIN
        v_caller_id := auth.uid();
        v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

        IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
          RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
        END IF;

        IF v_caller_id IS NOT NULL THEN
          SELECT account_role INTO v_caller_role
          FROM public.profiles
          WHERE account_id = p_account_id AND user_id = v_caller_id LIMIT 1;

          IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
          END IF;
          IF v_caller_role = 'viewer' THEN
            RAISE EXCEPTION 'Forbidden: viewers cannot snooze tasks' USING ERRCODE = '42501';
          END IF;
        ELSE
          v_caller_role := 'admin';
        END IF;

        SELECT * INTO v_task
        FROM public.tasks
        WHERE id = p_task_id AND account_id = p_account_id FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Task not found in account' USING ERRCODE = 'P0002';
        END IF;

        IF v_caller_role = 'agent' AND v_task.assigned_user_id IS NOT NULL AND v_task.assigned_user_id <> v_caller_id THEN
          RAISE EXCEPTION 'Forbidden: agent cannot snooze tasks assigned to another operator' USING ERRCODE = '42501';
        END IF;

        PERFORM set_config('ciclopes.allow_task_lifecycle_update', 'on', true);

        UPDATE public.tasks
        SET
          original_due_at = COALESCE(original_due_at, due_at),
          snoozed_until = p_snooze_until,
          snooze_count = snooze_count + 1,
          snooze_reason = COALESCE(p_reason, snooze_reason),
          updated_at = now()
        WHERE id = p_task_id AND account_id = p_account_id
        RETURNING * INTO v_updated;

        RETURN jsonb_build_object(
          'success', true,
          'task_id', v_updated.id,
          'snoozed_until', v_updated.snoozed_until,
          'snooze_count', v_updated.snooze_count,
          'original_due_at', v_updated.original_due_at
        );
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.complete_followup_atomic(
        p_account_id UUID,
        p_task_id UUID,
        p_completed_by UUID DEFAULT NULL
      )
      RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE
        v_caller_id UUID;
        v_caller_role account_role_enum;
        v_jwt_role TEXT;
        v_effective_completed_by UUID;
        v_task RECORD;
        v_updated RECORD;
      BEGIN
        v_caller_id := auth.uid();
        v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

        IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
          RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
        END IF;

        IF v_caller_id IS NOT NULL THEN
          SELECT account_role INTO v_caller_role
          FROM public.profiles
          WHERE account_id = p_account_id AND user_id = v_caller_id LIMIT 1;

          IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
          END IF;
          IF v_caller_role = 'viewer' THEN
            RAISE EXCEPTION 'Forbidden: viewers cannot complete tasks' USING ERRCODE = '42501';
          END IF;
          v_effective_completed_by := v_caller_id;
        ELSE
          v_caller_role := 'admin';
          v_effective_completed_by := p_completed_by;
        END IF;

        SELECT * INTO v_task
        FROM public.tasks
        WHERE id = p_task_id AND account_id = p_account_id FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Task not found in account' USING ERRCODE = 'P0002';
        END IF;

        IF v_caller_role = 'agent' AND v_task.assigned_user_id IS NOT NULL AND v_task.assigned_user_id <> v_caller_id THEN
          RAISE EXCEPTION 'Forbidden: agent cannot complete tasks assigned to another operator' USING ERRCODE = '42501';
        END IF;

        PERFORM set_config('ciclopes.allow_task_lifecycle_update', 'on', true);

        UPDATE public.tasks
        SET
          status = 'completed',
          completed_at = now(),
          completed_by_user_id = v_effective_completed_by,
          updated_at = now()
        WHERE id = p_task_id AND account_id = p_account_id
        RETURNING * INTO v_updated;

        RETURN jsonb_build_object(
          'success', true,
          'task_id', v_updated.id,
          'status', v_updated.status,
          'completed_at', v_updated.completed_at,
          'completed_by_user_id', v_updated.completed_by_user_id
        );
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.get_followups_cockpit(
        p_account_id UUID,
        p_assigned_user_id UUID DEFAULT NULL,
        p_view TEXT DEFAULT 'today',
        p_limit INTEGER DEFAULT 50,
        p_offset INTEGER DEFAULT 0
      )
      RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE
        v_caller_id UUID;
        v_caller_role account_role_enum;
        v_jwt_role TEXT;
        v_effective_assigned_user UUID;
        v_tz TEXT;
        v_now TIMESTAMPTZ := clock_timestamp();
        v_today_start TIMESTAMPTZ;
        v_today_end TIMESTAMPTZ;
        v_total INTEGER;
        v_items JSONB;
      BEGIN
        v_caller_id := auth.uid();
        v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

        IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
          RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
        END IF;

        IF v_caller_id IS NOT NULL THEN
          SELECT account_role INTO v_caller_role
          FROM public.profiles
          WHERE account_id = p_account_id AND user_id = v_caller_id LIMIT 1;

          IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
          END IF;
        ELSE
          v_caller_role := 'admin';
        END IF;

        IF v_caller_role = 'agent' THEN
          IF p_assigned_user_id IS NOT NULL AND p_assigned_user_id <> v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: agents cannot query follow-ups assigned to other operators' USING ERRCODE = '42501';
          END IF;
          v_effective_assigned_user := v_caller_id;
        ELSE
          v_effective_assigned_user := p_assigned_user_id;
        END IF;

        SELECT timezone INTO v_tz FROM public.accounts WHERE id = p_account_id;
        IF NOT public.is_valid_timezone(v_tz) THEN v_tz := 'UTC'; END IF;

        v_today_start := (date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz);
        v_today_end := v_today_start + interval '1 day' - interval '1 microsecond';

        SELECT count(*) INTO v_total
        FROM public.tasks t
        WHERE t.account_id = p_account_id
          AND (v_effective_assigned_user IS NULL OR t.assigned_user_id = v_effective_assigned_user);

        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_items
        FROM (
          SELECT * FROM public.tasks
          WHERE account_id = p_account_id
            AND (v_effective_assigned_user IS NULL OR assigned_user_id = v_effective_assigned_user)
          LIMIT p_limit OFFSET p_offset
        ) t;

        RETURN jsonb_build_object(
          'total', v_total,
          'timezone', v_tz,
          'view', p_view,
          'items', v_items
        );
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.get_leads_without_next_action(
        p_account_id UUID,
        p_assigned_user_id UUID DEFAULT NULL,
        p_limit INTEGER DEFAULT 50,
        p_offset INTEGER DEFAULT 0,
        p_min_lead_score INTEGER DEFAULT 40,
        p_max_conversation_days INTEGER DEFAULT 30
      )
      RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE
        v_caller_id UUID;
        v_caller_role account_role_enum;
        v_jwt_role TEXT;
      BEGIN
        v_caller_id := auth.uid();
        v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

        IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
          RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
        END IF;

        IF v_caller_id IS NOT NULL THEN
          SELECT account_role INTO v_caller_role
          FROM public.profiles
          WHERE account_id = p_account_id AND user_id = v_caller_id LIMIT 1;

          IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
          END IF;
        END IF;

        IF v_caller_role = 'agent' AND p_assigned_user_id IS NOT NULL AND p_assigned_user_id <> v_caller_id THEN
          RAISE EXCEPTION 'Forbidden: agents cannot query leads assigned to other operators' USING ERRCODE = '42501';
        END IF;

        RETURN jsonb_build_object('total', 0, 'items', '[]'::jsonb);
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.get_forgotten_leads(
        p_account_id UUID,
        p_assigned_user_id UUID DEFAULT NULL,
        p_inactive_hours INTEGER DEFAULT 72,
        p_limit INTEGER DEFAULT 50,
        p_offset INTEGER DEFAULT 0,
        p_min_lead_score INTEGER DEFAULT 30
      )
      RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE
        v_caller_id UUID;
        v_caller_role account_role_enum;
        v_jwt_role TEXT;
      BEGIN
        v_caller_id := auth.uid();
        v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

        IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
          RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
        END IF;

        IF v_caller_id IS NOT NULL THEN
          SELECT account_role INTO v_caller_role
          FROM public.profiles
          WHERE account_id = p_account_id AND user_id = v_caller_id LIMIT 1;

          IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
          END IF;
        END IF;

        IF v_caller_role = 'agent' AND p_assigned_user_id IS NOT NULL AND p_assigned_user_id <> v_caller_id THEN
          RAISE EXCEPTION 'Forbidden: agents cannot query leads assigned to other operators' USING ERRCODE = '42501';
        END IF;

        RETURN jsonb_build_object('total', 0, 'items', '[]'::jsonb);
      END;
      $$;

      -- Seed data
      INSERT INTO auth.users (id, email) VALUES
        ('${ownerA}', 'owner@ciclopes.test'),
        ('${sellerA}', 'seller.a.v11@ciclopes.test'),
        ('${sellerB}', 'seller.b.v11@ciclopes.test'),
        ('${viewerA}', 'viewer@ciclopes.test');

      INSERT INTO accounts (id, name, timezone, seller_conversation_visibility) VALUES
        ('${accountA}', 'Pilot Account', 'America/Sao_Paulo', 'assigned_only'),
        ('${accountB}', 'Other Tenant Account', 'America/New_York', 'all');

      INSERT INTO profiles (user_id, account_id, full_name, email, account_role) VALUES
        ('${ownerA}', '${accountA}', 'Owner Boss', 'owner@ciclopes.test', 'owner'),
        ('${sellerA}', '${accountA}', 'Vendedor Alpha', 'seller.a.v11@ciclopes.test', 'agent'),
        ('${sellerB}', '${accountA}', 'Vendedor Beta', 'seller.b.v11@ciclopes.test', 'agent'),
        ('${viewerA}', '${accountA}', 'Visualizador Teste', 'viewer@ciclopes.test', 'viewer');

      INSERT INTO contacts (id, account_id, user_id, phone, whatsapp_lid, name) VALUES
        ('${contactA}', '${accountA}', '${sellerA}', '5513974135365', '25190000009361@lid', 'Leo Possatti');

      INSERT INTO conversations (id, account_id, user_id, contact_id, external_chat_id, assigned_agent_id) VALUES
        ('${convA}', '${accountA}', '${sellerA}', '${contactA}', '25190000009361@lid', '${sellerA}');

      INSERT INTO deals (id, account_id, contact_id, title, value, status) VALUES
        ('${dealA}', '${accountA}', '${contactA}', 'Contrato Enterprise', 15000, 'open');

      INSERT INTO contact_lead_scores (account_id, contact_id, score) VALUES
        ('${accountA}', '${contactA}', 85);
    `);

    // Insert pilot tasks
    const resA = await pg.query(`
      INSERT INTO tasks (account_id, contact_id, conversation_id, assigned_user_id, created_by_user_id, title, action_type, due_at)
      VALUES ('${accountA}', '${contactA}', '${convA}', '${sellerA}', '${sellerA}', 'Task Seller A', 'message', now() + interval '1 hour')
      RETURNING id;
    `);
    taskSellerAId = resA.rows[0].id;

    const resB = await pg.query(`
      INSERT INTO tasks (account_id, contact_id, conversation_id, assigned_user_id, created_by_user_id, title, action_type, due_at)
      VALUES ('${accountA}', '${contactA}', '${convA}', '${sellerB}', '${sellerB}', 'Task Seller B', 'call', now() + interval '2 hours')
      RETURNING id;
    `);
    taskSellerBId = resB.rows[0].id;
  });

  async function asUser(userId: string | null, fn: () => Promise<void>) {
    if (userId) {
      await pg.exec(`SET request.jwt.claim.sub = '${userId}'; SET request.jwt.claim.role = 'authenticated';`);
    } else {
      await pg.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'anon';`);
    }
    try {
      await fn();
    } finally {
      await pg.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';`);
    }
  }

  // 1. anon get_followups_cockpit → denied
  it('1. anon get_followups_cockpit → denied', async () => {
    await asUser(null, async () => {
      await expect(
        pg.query(`SELECT get_followups_cockpit('${accountA}', NULL, 'today');`)
      ).rejects.toThrow(/Unauthorized/);
    });
  });

  // 2. anon get_leads_without_next_action → denied
  it('2. anon get_leads_without_next_action → denied', async () => {
    await asUser(null, async () => {
      await expect(
        pg.query(`SELECT get_leads_without_next_action('${accountA}', NULL);`)
      ).rejects.toThrow(/Unauthorized/);
    });
  });

  // 3. anon get_forgotten_leads → denied
  it('3. anon get_forgotten_leads → denied', async () => {
    await asUser(null, async () => {
      await expect(
        pg.query(`SELECT get_forgotten_leads('${accountA}', NULL);`)
      ).rejects.toThrow(/Unauthorized/);
    });
  });

  // 4. seller account A chama RPC com account B → denied
  it('4. seller account A chama RPC com account B → denied', async () => {
    await asUser(sellerA, async () => {
      await expect(
        pg.query(`SELECT get_followups_cockpit('${accountB}', NULL, 'today');`)
      ).rejects.toThrow(/Forbidden.*not a member/);
    });
  });

  // 5. seller A pede cockpit de seller B → denied
  it('5. seller A pede cockpit de seller B → denied', async () => {
    await asUser(sellerA, async () => {
      await expect(
        pg.query(`SELECT get_followups_cockpit('${accountA}', '${sellerB}', 'today');`)
      ).rejects.toThrow(/Forbidden.*agents cannot query follow-ups assigned to other operators/);
    });
  });

  // 6. seller A pede cockpit NULL para tentar ver equipe → restricted to Seller A
  it('6. seller A pede cockpit NULL para tentar ver equipe → restricted to Seller A', async () => {
    await asUser(sellerA, async () => {
      const res = await pg.query(`SELECT get_followups_cockpit('${accountA}', NULL, 'today');`);
      const data = res.rows[0].get_followups_cockpit;
      expect(data.total).toBe(1);
      expect(data.items[0].assigned_user_id).toBe(sellerA);
    });
  });

  // 7. owner A vê seller A/B da própria account → allowed
  it('7. owner A vê seller A/B da própria account → allowed', async () => {
    await asUser(ownerA, async () => {
      const res = await pg.query(`SELECT get_followups_cockpit('${accountA}', NULL, 'today');`);
      const data = res.rows[0].get_followups_cockpit;
      expect(data.total).toBe(2);
    });
  });

  // 8. owner A account B → denied
  it('8. owner A account B → denied', async () => {
    await asUser(ownerA, async () => {
      await expect(
        pg.query(`SELECT get_followups_cockpit('${accountB}', NULL, 'today');`)
      ).rejects.toThrow(/Forbidden.*not a member/);
    });
  });

  // 11. seller A complete task B → denied
  it('11. seller A complete task B → denied', async () => {
    await asUser(sellerA, async () => {
      await expect(
        pg.query(`SELECT complete_followup_atomic('${accountA}', '${taskSellerBId}');`)
      ).rejects.toThrow(/Forbidden: agent cannot complete tasks assigned to another operator/);
    });
  });

  // 12. seller A snooze task B → denied
  it('12. seller A snooze task B → denied', async () => {
    await asUser(sellerA, async () => {
      await expect(
        pg.query(`SELECT snooze_followup_atomic('${accountA}', '${taskSellerBId}', now() + interval '1 day');`)
      ).rejects.toThrow(/Forbidden: agent cannot snooze tasks assigned to another operator/);
    });
  });

  // 13. seller A forja completed_by=B → impossible (completer remains Seller A)
  it('13. seller A forja completed_by=B → completed_by is forced to Seller A', async () => {
    await asUser(sellerA, async () => {
      const res = await pg.query(
        `SELECT complete_followup_atomic('${accountA}', '${taskSellerAId}', '${sellerB}');`
      );
      const result = res.rows[0].complete_followup_atomic;
      expect(result.success).toBe(true);
      expect(result.completed_by_user_id).toBe(sellerA);
    });
  });

  // 14. direct UPDATE status='completed' bypassando RPC → denied
  it("14. direct UPDATE status='completed' bypassando RPC → denied by guard trigger", async () => {
    await asUser(sellerA, async () => {
      await expect(
        pg.query(`UPDATE tasks SET status = 'completed', completed_at = now() WHERE id = '${taskSellerAId}';`)
      ).rejects.toThrow(/Direct completion of task is forbidden/);
    });
  });

  // 15. direct UPDATE snoozed_until bypassando RPC → denied by guard trigger
  it("15. direct UPDATE snoozed_until bypassando RPC → denied by guard trigger", async () => {
    await asUser(sellerA, async () => {
      await expect(
        pg.query(`UPDATE tasks SET snoozed_until = now() + interval '2 days', snooze_count = 1 WHERE id = '${taskSellerAId}';`)
      ).rejects.toThrow(/Direct snooze of task is forbidden/);
    });
  });

  // 18. service_role workers continuam funcionando
  it('18. service_role workers continuam funcionando', async () => {
    await pg.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'service_role';`);
    try {
      const snoozeRes = await pg.query(`
        SELECT snooze_followup_atomic('${accountA}', '${taskSellerAId}', now() + interval '1 day', 'Service worker snooze');
      `);
      expect(snoozeRes.rows[0].snooze_followup_atomic.success).toBe(true);

      const completeRes = await pg.query(`
        SELECT complete_followup_atomic('${accountA}', '${taskSellerAId}', '${sellerA}');
      `);
      expect(completeRes.rows[0].complete_followup_atomic.success).toBe(true);
      expect(completeRes.rows[0].complete_followup_atomic.completed_by_user_id).toBe(sellerA);
    } finally {
      await pg.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';`);
    }
  });
});
