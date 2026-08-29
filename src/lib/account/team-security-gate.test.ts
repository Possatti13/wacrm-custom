/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
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

describe('CICLOPES V1.1.1 — Team Security Hardening & Audit Matrix', () => {
  let db: any;
  const tenantAId = 'aaaaaaaa-1111-4111-a111-aaaaaaaaaaaa';
  const tenantBId = 'bbbbbbbb-2222-4222-b222-bbbbbbbbbbbb';

  const ownerAId = '11111111-1111-4111-a111-111111111111';
  const adminAId = '22222222-2222-4222-a222-222222222222';
  const sellerA1Id = '33333333-3333-4333-a333-333333333333';
  const sellerA2Id = '44444444-4444-4444-a444-444444444444';
  const viewerAId = '55555555-5555-4555-a555-555555555555';
  const sellerBId = '66666666-6666-4666-b666-666666666666';

  const conv1Id = 'cccccccc-1111-4111-c111-111111111111';
  const conv2Id = 'cccccccc-2222-4222-c222-222222222222';

  beforeEach(async () => {
    db = new PGlite();

    // 1. Core extensions and auth simulation
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY,
        email TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');

      CREATE TABLE accounts (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id UUID,
        seller_conversation_visibility TEXT NOT NULL DEFAULT 'all',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        email TEXT,
        account_role account_role_enum NOT NULL DEFAULT 'agent',
        role TEXT NOT NULL DEFAULT 'agent',
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(account_id, user_id)
      );

      CREATE OR REPLACE FUNCTION public.is_account_member(target_account_id UUID, min_role account_role_enum DEFAULT 'viewer')
      RETURNS BOOLEAN
      LANGUAGE plpgsql
      STABLE
      AS $$
      DECLARE
        v_role account_role_enum;
      BEGIN
        SELECT account_role INTO v_role
        FROM public.profiles
        WHERE user_id = auth.uid() AND account_id = target_account_id;

        IF v_role IS NULL THEN RETURN FALSE; END IF;
        IF min_role = 'viewer' THEN RETURN TRUE; END IF;
        IF min_role = 'agent' THEN RETURN v_role IN ('agent', 'admin', 'owner'); END IF;
        IF min_role = 'admin' THEN RETURN v_role IN ('admin', 'owner'); END IF;
        IF min_role = 'owner' THEN RETURN v_role = 'owner'; END IF;
        RETURN FALSE;
      END;
      $$;

      CREATE TABLE contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        phone TEXT,
        name TEXT,
        whatsapp_lid TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        contact_id UUID NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        assigned_agent_id UUID,
        first_customer_message_at TIMESTAMPTZ,
        first_response_at TIMESTAMPTZ,
        first_response_duration_seconds INTEGER,
        last_customer_message_at TIMESTAMPTZ,
        last_agent_message_at TIMESTAMPTZ,
        unattended_since TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT fk_conv_assigned_agent FOREIGN KEY (account_id, assigned_agent_id) REFERENCES profiles(account_id, user_id) ON DELETE SET NULL,
        UNIQUE (account_id, id)
      );

      CREATE TABLE messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('agent', 'customer', 'bot')),
        sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        content_type TEXT NOT NULL DEFAULT 'text',
        content_text TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE conversation_assignment_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        conversation_id UUID NOT NULL,
        assigned_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('assigned', 'reassigned', 'unassigned', 'claimed', 'transferred')),
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_cah_conversation_same_account FOREIGN KEY (account_id, conversation_id) REFERENCES conversations(account_id, id) ON DELETE CASCADE
      );
    `);

    // 2. Load migration 070 & 071 SQL logic
    await db.exec(`
      -- Guard trigger against direct update to assigned_agent_id
      CREATE OR REPLACE FUNCTION public.guard_assigned_agent_id_update()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
        IF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
          IF current_setting('app.assignment_in_progress', true) IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION 'Direct update to assigned_agent_id is prohibited. Use assign_conversation_atomic procedure.'
              USING ERRCODE = '42501';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS trg_guard_assigned_agent_id ON public.conversations;
      CREATE TRIGGER trg_guard_assigned_agent_id
        BEFORE UPDATE OF assigned_agent_id ON public.conversations
        FOR EACH ROW
        EXECUTE FUNCTION public.guard_assigned_agent_id_update();

      -- assign_conversation_atomic with security hardening
      CREATE OR REPLACE FUNCTION public.assign_conversation_atomic(
        p_account_id UUID,
        p_conversation_id UUID,
        p_target_user_id UUID,
        p_reason TEXT DEFAULT NULL,
        p_expected_current_agent_id UUID DEFAULT NULL,
        p_force BOOLEAN DEFAULT FALSE
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        v_caller_id UUID;
        v_caller_role account_role_enum;
        v_conv RECORD;
        v_target_profile RECORD;
        v_event_type TEXT;
        v_history_id UUID;
      BEGIN
        v_caller_id := auth.uid();
        IF v_caller_id IS NULL THEN
          RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
        END IF;

        -- 1. Validate caller membership & role
        SELECT account_role INTO v_caller_role
        FROM public.profiles
        WHERE user_id = v_caller_id AND account_id = p_account_id;

        IF v_caller_role IS NULL THEN
          RAISE EXCEPTION 'Forbidden: caller is not a member of this account' USING ERRCODE = '42501';
        END IF;

        IF v_caller_role = 'viewer' THEN
          RAISE EXCEPTION 'Forbidden: viewers cannot assign or transfer conversations' USING ERRCODE = '42501';
        END IF;

        -- 2. Privilege escalation check: agent can NEVER force reassignment
        IF p_force AND v_caller_role NOT IN ('owner', 'admin') THEN
          RAISE EXCEPTION 'Forbidden: only owners and managers can force assignment override' USING ERRCODE = '42501';
        END IF;

        -- 3. Lock conversation row for update
        SELECT id, account_id, assigned_agent_id, status
        INTO v_conv
        FROM public.conversations
        WHERE id = p_conversation_id AND account_id = p_account_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Conversation not found in account' USING ERRCODE = 'P0002';
        END IF;

        -- 4. Validate target user if not unassigning
        IF p_target_user_id IS NOT NULL THEN
          SELECT user_id, full_name, account_role
          INTO v_target_profile
          FROM public.profiles
          WHERE user_id = p_target_user_id AND account_id = p_account_id;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'Target user does not belong to this account' USING ERRCODE = '23503';
          END IF;

          IF v_target_profile.account_role = 'viewer' THEN
            RAISE EXCEPTION 'Target user is a viewer and cannot be assigned conversations' USING ERRCODE = '23514';
          END IF;
        END IF;

        -- 5. Optimistic concurrency check
        IF NOT (p_force AND v_caller_role IN ('owner', 'admin')) AND p_expected_current_agent_id IS NOT NULL THEN
          IF v_conv.assigned_agent_id IS DISTINCT FROM p_expected_current_agent_id THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'CONCURRENCY_CONFLICT',
              'message', 'Conversation assignment was modified by another operator.',
              'current_assigned_agent_id', v_conv.assigned_agent_id
            );
          END IF;
        END IF;

        -- 6. Role-based assignment permission check for 'agent' role
        IF v_caller_role = 'agent' THEN
          IF v_conv.assigned_agent_id IS NULL THEN
            IF p_target_user_id <> v_caller_id THEN
              RAISE EXCEPTION 'Agents can only claim unassigned conversations for themselves' USING ERRCODE = '42501';
            END IF;
          ELSIF v_conv.assigned_agent_id <> v_caller_id THEN
            RAISE EXCEPTION 'Agents cannot reassign conversations owned by other operators' USING ERRCODE = '42501';
          END IF;
        END IF;

        -- 7. Determine event type
        IF v_conv.assigned_agent_id IS NULL AND p_target_user_id = v_caller_id THEN
          v_event_type := 'claimed';
        ELSIF v_conv.assigned_agent_id IS NULL AND p_target_user_id IS NOT NULL THEN
          v_event_type := 'assigned';
        ELSIF p_target_user_id IS NULL THEN
          v_event_type := 'unassigned';
        ELSIF v_conv.assigned_agent_id = v_caller_id AND p_target_user_id <> v_caller_id THEN
          v_event_type := 'transferred';
        ELSE
          v_event_type := 'reassigned';
        END IF;

        IF v_conv.assigned_agent_id IS NOT DISTINCT FROM p_target_user_id THEN
          RETURN jsonb_build_object(
            'success', true,
            'no_op', true,
            'conversation_id', p_conversation_id,
            'assigned_agent_id', p_target_user_id
          );
        END IF;

        -- 8. Set session authorization flag
        PERFORM set_config('app.assignment_in_progress', 'true', true);

        -- 9. Update conversation
        UPDATE public.conversations
        SET
          assigned_agent_id = p_target_user_id,
          updated_at = now()
        WHERE id = p_conversation_id;

        -- 10. Insert history record
        INSERT INTO public.conversation_assignment_history (
          account_id,
          conversation_id,
          assigned_by_user_id,
          from_user_id,
          to_user_id,
          event_type,
          reason
        ) VALUES (
          p_account_id,
          p_conversation_id,
          v_caller_id,
          v_conv.assigned_agent_id,
          p_target_user_id,
          v_event_type,
          p_reason
        ) RETURNING id INTO v_history_id;

        RETURN jsonb_build_object(
          'success', true,
          'conversation_id', p_conversation_id,
          'previous_agent_id', v_conv.assigned_agent_id,
          'assigned_agent_id', p_target_user_id,
          'event_type', v_event_type,
          'history_id', v_history_id
        );
      END;
      $$;

      -- Seller visibility check function
      CREATE OR REPLACE FUNCTION public.check_conversation_visibility(
        p_account_id UUID,
        p_assigned_agent_id UUID
      )
      RETURNS BOOLEAN
      LANGUAGE plpgsql
      STABLE
      AS $$
      DECLARE
        v_user_id UUID := auth.uid();
        v_role account_role_enum;
        v_visibility TEXT;
      BEGIN
        IF v_user_id IS NULL THEN RETURN FALSE; END IF;

        SELECT account_role INTO v_role
        FROM public.profiles
        WHERE user_id = v_user_id AND account_id = p_account_id;

        IF v_role IS NULL THEN RETURN FALSE; END IF;
        IF v_role IN ('owner', 'admin', 'viewer') THEN RETURN TRUE; END IF;

        SELECT seller_conversation_visibility INTO v_visibility
        FROM public.accounts
        WHERE id = p_account_id;

        v_visibility := COALESCE(v_visibility, 'all');

        IF v_visibility = 'all' THEN
          RETURN TRUE;
        ELSIF v_visibility = 'assigned_and_unassigned' THEN
          RETURN (p_assigned_agent_id IS NULL OR p_assigned_agent_id = v_user_id);
        ELSIF v_visibility = 'assigned_only' THEN
          RETURN (p_assigned_agent_id IS NOT NULL AND p_assigned_agent_id = v_user_id);
        END IF;

        RETURN TRUE;
      END;
      $$;
    `);

    // 3. Populate Test Data
    await db.exec(`
      INSERT INTO accounts (id, name, seller_conversation_visibility) VALUES
        ('${tenantAId}', 'Tenant Alpha', 'all'),
        ('${tenantBId}', 'Tenant Beta', 'all');

      INSERT INTO auth.users (id, email) VALUES
        ('${ownerAId}', 'owner.a@test.com'),
        ('${adminAId}', 'admin.a@test.com'),
        ('${sellerA1Id}', 'seller.a1@test.com'),
        ('${sellerA2Id}', 'seller.a2@test.com'),
        ('${viewerAId}', 'viewer.a@test.com'),
        ('${sellerBId}', 'seller.b@test.com');

      INSERT INTO profiles (user_id, account_id, full_name, email, account_role, role) VALUES
        ('${ownerAId}', '${tenantAId}', 'Owner Alice', 'owner.a@test.com', 'owner', 'owner'),
        ('${adminAId}', '${tenantAId}', 'Manager Bob', 'admin.a@test.com', 'admin', 'admin'),
        ('${sellerA1Id}', '${tenantAId}', 'Seller Alpha', 'seller.a1@test.com', 'agent', 'agent'),
        ('${sellerA2Id}', '${tenantAId}', 'Seller Beta', 'seller.a2@test.com', 'agent', 'agent'),
        ('${viewerAId}', '${tenantAId}', 'Viewer Val', 'viewer.a@test.com', 'viewer', 'viewer'),
        ('${sellerBId}', '${tenantBId}', 'Seller Other Tenant', 'seller.b@test.com', 'agent', 'agent');

      INSERT INTO contacts (id, account_id, user_id, name, phone) VALUES
        ('dddddddd-1111-4111-d111-111111111111', '${tenantAId}', '${ownerAId}', 'Customer 1', '5511999999991'),
        ('dddddddd-2222-4222-d222-222222222222', '${tenantAId}', '${ownerAId}', 'Customer 2', '5511999999992');

      INSERT INTO conversations (id, account_id, user_id, contact_id, assigned_agent_id) VALUES
        ('${conv1Id}', '${tenantAId}', '${ownerAId}', 'dddddddd-1111-4111-d111-111111111111', NULL),
        ('${conv2Id}', '${tenantAId}', '${ownerAId}', 'dddddddd-2222-4222-d222-222222222222', '${sellerA1Id}');
    `);
  });

  function asUser(userId: string | null) {
    return db.exec(`SET request.jwt.claim.sub = '${userId || ''}';`);
  }

  it('1. anon execute RPC -> denied (Unauthorized)', async () => {
    await asUser(null);
    await expect(
      db.query(`SELECT assign_conversation_atomic('${tenantAId}', '${conv1Id}', '${sellerA1Id}');`)
    ).rejects.toThrow(/Unauthorized/);
  });

  it('2. viewer RPC -> denied (Forbidden)', async () => {
    await asUser(viewerAId);
    await expect(
      db.query(`SELECT assign_conversation_atomic('${tenantAId}', '${conv1Id}', '${viewerAId}');`)
    ).rejects.toThrow(/Forbidden: viewers cannot assign/);
  });

  it('3. agent claim unassigned -> allowed', async () => {
    await asUser(sellerA1Id);
    const res = await db.query(`
      SELECT assign_conversation_atomic('${tenantAId}', '${conv1Id}', '${sellerA1Id}', 'Claiming lead');
    `);
    const data = (res.rows[0] as any).assign_conversation_atomic;
    expect(data.success).toBe(true);
    expect(data.event_type).toBe('claimed');
    expect(data.assigned_agent_id).toBe(sellerA1Id);

    // Verify conversation was updated in DB
    const conv = await db.query(`SELECT assigned_agent_id FROM conversations WHERE id = '${conv1Id}';`);
    expect((conv.rows[0] as any).assigned_agent_id).toBe(sellerA1Id);

    // Verify history row exists
    const hist = await db.query(`SELECT * FROM conversation_assignment_history WHERE conversation_id = '${conv1Id}';`);
    expect(hist.rows).toHaveLength(1);
    expect((hist.rows[0] as any).event_type).toBe('claimed');
    expect((hist.rows[0] as any).assigned_by_user_id).toBe(sellerA1Id);
  });

  it('4. agent assign unassigned to another seller -> denied', async () => {
    await asUser(sellerA1Id);
    await expect(
      db.query(`SELECT assign_conversation_atomic('${tenantAId}', '${conv1Id}', '${sellerA2Id}');`)
    ).rejects.toThrow(/Agents can only claim unassigned conversations for themselves/);
  });

  it('5. agent B reassign conversation of A -> denied', async () => {
    await asUser(sellerA2Id);
    await expect(
      db.query(`SELECT assign_conversation_atomic('${tenantAId}', '${conv2Id}', '${sellerA2Id}');`)
    ).rejects.toThrow(/Agents cannot reassign conversations owned by other operators/);
  });

  it('6. agent B p_force=true privilege escalation -> DENIED', async () => {
    await asUser(sellerA2Id);
    await expect(
      db.query(`SELECT assign_conversation_atomic('${tenantAId}', '${conv2Id}', '${sellerA2Id}', 'trying force', NULL, true);`)
    ).rejects.toThrow(/Forbidden: only owners and managers can force assignment override/);
  });

  it('7. owner reassign -> allowed', async () => {
    await asUser(ownerAId);
    const res = await db.query(`
      SELECT assign_conversation_atomic('${tenantAId}', '${conv2Id}', '${sellerA2Id}', 'Manager reassign');
    `);
    const data = (res.rows[0] as any).assign_conversation_atomic;
    expect(data.success).toBe(true);
    expect(data.event_type).toBe('reassigned');
    expect(data.assigned_agent_id).toBe(sellerA2Id);
    expect(data.previous_agent_id).toBe(sellerA1Id);
  });

  it('8. admin reassign -> allowed', async () => {
    await asUser(adminAId);
    const res = await db.query(`
      SELECT assign_conversation_atomic('${tenantAId}', '${conv2Id}', '${sellerA2Id}', 'Admin reassign');
    `);
    const data = (res.rows[0] as any).assign_conversation_atomic;
    expect(data.success).toBe(true);
    expect(data.event_type).toBe('reassigned');
  });

  it('9. cross-tenant target -> denied', async () => {
    await asUser(ownerAId);
    await expect(
      db.query(`SELECT assign_conversation_atomic('${tenantAId}', '${conv1Id}', '${sellerBId}');`)
    ).rejects.toThrow(/Target user does not belong to this account/);
  });

  it('10. direct assigned_agent_id update bypass -> DENIED by guard trigger', async () => {
    await asUser(sellerA1Id);
    await expect(
      db.query(`UPDATE conversations SET assigned_agent_id = '${sellerA1Id}' WHERE id = '${conv1Id}';`)
    ).rejects.toThrow(/Direct update to assigned_agent_id is prohibited. Use assign_conversation_atomic procedure./);
  });

  it('11. concurrency conflict detection in assign_conversation_atomic', async () => {
    await asUser(sellerA1Id);
    // Expected agent was NULL, but currently conv2 is assigned to sellerA1Id
    const res = await db.query(`
      SELECT assign_conversation_atomic('${tenantAId}', '${conv2Id}', '${sellerA2Id}', 'claim', '00000000-0000-0000-0000-000000000000');
    `);
    const data = (res.rows[0] as any).assign_conversation_atomic;
    expect(data.success).toBe(false);
    expect(data.error).toBe('CONCURRENCY_CONFLICT');
  });

  it('12. seller visibility enforcement (all vs assigned_and_unassigned vs assigned_only)', async () => {
    // A) Policy 'all'
    await db.query(`UPDATE accounts SET seller_conversation_visibility = 'all' WHERE id = '${tenantAId}';`);
    await asUser(sellerA2Id);
    const checkAllMine = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA2Id}') as ok;`);
    expect((checkAllMine.rows[0] as any).ok).toBe(true);
    const checkAllOther = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA1Id}') as ok;`);
    expect((checkAllOther.rows[0] as any).ok).toBe(true);

    // B) Policy 'assigned_and_unassigned'
    await db.query(`UPDATE accounts SET seller_conversation_visibility = 'assigned_and_unassigned' WHERE id = '${tenantAId}';`);
    await asUser(sellerA2Id);
    const checkAUUnassigned = await db.query(`SELECT check_conversation_visibility('${tenantAId}', NULL) as ok;`);
    expect((checkAUUnassigned.rows[0] as any).ok).toBe(true);
    const checkAUMine = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA2Id}') as ok;`);
    expect((checkAUMine.rows[0] as any).ok).toBe(true);
    const checkAUOther = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA1Id}') as ok;`);
    expect((checkAUOther.rows[0] as any).ok).toBe(false);

    // C) Policy 'assigned_only'
    await db.query(`UPDATE accounts SET seller_conversation_visibility = 'assigned_only' WHERE id = '${tenantAId}';`);
    await asUser(sellerA2Id);
    const checkAOUnassigned = await db.query(`SELECT check_conversation_visibility('${tenantAId}', NULL) as ok;`);
    expect((checkAOUnassigned.rows[0] as any).ok).toBe(false);
    const checkAOMine = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA2Id}') as ok;`);
    expect((checkAOMine.rows[0] as any).ok).toBe(true);
    const checkAOOther = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA1Id}') as ok;`);
    expect((checkAOOther.rows[0] as any).ok).toBe(false);

    // D) Owner / Admin always sees all even under 'assigned_only'
    await asUser(ownerAId);
    const checkOwner = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA1Id}') as ok;`);
    expect((checkOwner.rows[0] as any).ok).toBe(true);

    await asUser(adminAId);
    const checkAdmin = await db.query(`SELECT check_conversation_visibility('${tenantAId}', '${sellerA1Id}') as ok;`);
    expect((checkAdmin.rows[0] as any).ok).toBe(true);
  });
});
