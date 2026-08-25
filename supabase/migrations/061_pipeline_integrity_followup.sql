-- ============================================================
-- Migration 061: Pipeline Domain & Multi-Tenant Follow-up Hardening
--
-- Addresses Phase 15 integrity review findings:
--   1. Fix composite FK "ON DELETE SET NULL" to use explicit column lists
--      (e.g., ON DELETE SET NULL (contact_id)) preventing NOT NULL violations
--      on account_id when referenced entities are deleted.
--   2. Enforce strict same-pipeline invariants for deal_stage_suggestions
--      by adding pipeline_id and compound FKs to (account_id, pipeline_id, ...).
--   3. Hardened Security Definer trigger functions by revoking execute
--      from PUBLIC, anon, and authenticated.
--   4. Enforce tenant membership integrity for assignees across deals,
--      tasks, and conversations via composite FKs to profiles.
--   5. Drop redundant single-column FKs that duplicate composite constraints.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES (Composite Uniques for Multi-Tenant Assignment)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_profiles_account_id_id' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT uq_profiles_account_id_id UNIQUE (account_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_profiles_account_user_id' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT uq_profiles_account_user_id UNIQUE (account_id, user_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. PIPELINE STAGES (Cleanup Redundant FK)
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Redundant with fk_pipeline_stages_pipeline_account
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_stages_pipeline_id_fkey' AND conrelid = 'public.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE public.pipeline_stages DROP CONSTRAINT pipeline_stages_pipeline_id_fkey;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. CONVERSATIONS (Same-Tenant Contact & Assignee Hardening)
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Drop legacy contact FK
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_contact_id_fkey' AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_contact_id_fkey;
  END IF;

  -- Add composite contact FK (same account)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_conversations_contact_account' AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT fk_conversations_contact_account
      FOREIGN KEY (account_id, contact_id)
      REFERENCES public.contacts(account_id, id)
      ON DELETE CASCADE;
  END IF;

  -- Add composite assigned agent FK (must belong to same account)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_conversations_assigned_agent_account' AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT fk_conversations_assigned_agent_account
      FOREIGN KEY (account_id, assigned_agent_id)
      REFERENCES public.profiles(account_id, user_id)
      ON DELETE SET NULL (assigned_agent_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_account_assigned_agent
  ON public.conversations(account_id, assigned_agent_id);

-- ------------------------------------------------------------
-- 4. DEALS (Explicit SET NULL Column Lists & Assignee Hardening)
-- ------------------------------------------------------------
DO $$
BEGIN
  -- 1. Contact FK with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_deals_contact_account' AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals DROP CONSTRAINT fk_deals_contact_account;
  END IF;

  ALTER TABLE public.deals
    ADD CONSTRAINT fk_deals_contact_account
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE SET NULL (contact_id);

  -- 2. Conversation FK with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_deals_conversation_account' AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals DROP CONSTRAINT fk_deals_conversation_account;
  END IF;

  ALTER TABLE public.deals
    ADD CONSTRAINT fk_deals_conversation_account
    FOREIGN KEY (account_id, conversation_id)
    REFERENCES public.conversations(account_id, id)
    ON DELETE SET NULL (conversation_id);

  -- 3. Assigned to FK (same account profile) with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_assigned_to_fkey' AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals DROP CONSTRAINT deals_assigned_to_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_deals_assigned_to_account' AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals DROP CONSTRAINT fk_deals_assigned_to_account;
  END IF;

  ALTER TABLE public.deals
    ADD CONSTRAINT fk_deals_assigned_to_account
    FOREIGN KEY (account_id, assigned_to)
    REFERENCES public.profiles(account_id, id)
    ON DELETE SET NULL (assigned_to);

  -- 4. Unique (account_id, pipeline_id, id) for suggestion references
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_deals_account_pipeline_id' AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT uq_deals_account_pipeline_id UNIQUE (account_id, pipeline_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_account_assigned_to
  ON public.deals(account_id, assigned_to);

-- ------------------------------------------------------------
-- 5. TASKS (Explicit SET NULL Column Lists & Assignee Hardening)
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Drop redundant legacy single-column FKs if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_contact_id_fkey' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_contact_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_conversation_id_fkey' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_conversation_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_assigned_user_id_fkey' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_assigned_user_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_created_by_user_id_fkey' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_created_by_user_id_fkey;
  END IF;

  -- 1. Contact FK with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_contact_same_account' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_contact_same_account;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT fk_tasks_contact_same_account
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE SET NULL (contact_id);

  -- 2. Conversation FK with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_conversation_same_account' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_conversation_same_account;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT fk_tasks_conversation_same_account
    FOREIGN KEY (account_id, conversation_id)
    REFERENCES public.conversations(account_id, id)
    ON DELETE SET NULL (conversation_id);

  -- 3. Deal FK with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_deal_same_account' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_deal_same_account;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT fk_tasks_deal_same_account
    FOREIGN KEY (account_id, deal_id)
    REFERENCES public.deals(account_id, id)
    ON DELETE SET NULL (deal_id);

  -- 4. Assigned user FK (same account profile) with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_assigned_user_account' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_assigned_user_account;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT fk_tasks_assigned_user_account
    FOREIGN KEY (account_id, assigned_user_id)
    REFERENCES public.profiles(account_id, user_id)
    ON DELETE SET NULL (assigned_user_id);

  -- 5. Created by user FK (same account profile) with explicit column list
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_created_by_user_account' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_created_by_user_account;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT fk_tasks_created_by_user_account
    FOREIGN KEY (account_id, created_by_user_id)
    REFERENCES public.profiles(account_id, user_id)
    ON DELETE SET NULL (created_by_user_id);
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_account_assigned_user
  ON public.tasks(account_id, assigned_user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_account_created_by_user
  ON public.tasks(account_id, created_by_user_id);

-- ------------------------------------------------------------
-- 6. DEAL STAGE SUGGESTIONS (Pipeline ID & Strict Same-Pipeline Invariant)
-- ------------------------------------------------------------
-- Add pipeline_id column if not exists
ALTER TABLE public.deal_stage_suggestions
  ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE CASCADE;

-- Backfill pipeline_id from deals
UPDATE public.deal_stage_suggestions s
SET pipeline_id = d.pipeline_id
FROM public.deals d
WHERE s.deal_id = d.id
  AND s.account_id = d.account_id
  AND s.pipeline_id IS NULL;

-- Enforce NOT NULL on pipeline_id
ALTER TABLE public.deal_stage_suggestions
  ALTER COLUMN pipeline_id SET NOT NULL;

-- Auto-sync pipeline_id trigger if omitted on insert
CREATE OR REPLACE FUNCTION public.trg_deal_stage_suggestions_pipeline_id_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    SELECT pipeline_id INTO NEW.pipeline_id
    FROM public.deals
    WHERE account_id = NEW.account_id AND id = NEW.deal_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_stage_suggestions_pipeline_id_sync ON public.deal_stage_suggestions;
CREATE TRIGGER trg_deal_stage_suggestions_pipeline_id_sync
  BEFORE INSERT ON public.deal_stage_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deal_stage_suggestions_pipeline_id_sync();

-- Replace stage suggestions FKs with 3-column compound constraints:
-- (account_id, pipeline_id, deal_id) -> deals(account_id, pipeline_id, id)
-- (account_id, pipeline_id, suggested_stage_id) -> pipeline_stages(account_id, pipeline_id, id)
-- (account_id, pipeline_id, current_stage_id) -> pipeline_stages(account_id, pipeline_id, id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_deal_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions DROP CONSTRAINT deal_stage_suggestions_deal_id_fkey;
  END IF;

  ALTER TABLE public.deal_stage_suggestions
    ADD CONSTRAINT deal_stage_suggestions_deal_id_fkey
    FOREIGN KEY (account_id, pipeline_id, deal_id)
    REFERENCES public.deals(account_id, pipeline_id, id)
    ON DELETE CASCADE;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_suggested_stage_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions DROP CONSTRAINT deal_stage_suggestions_suggested_stage_id_fkey;
  END IF;

  ALTER TABLE public.deal_stage_suggestions
    ADD CONSTRAINT deal_stage_suggestions_suggested_stage_id_fkey
    FOREIGN KEY (account_id, pipeline_id, suggested_stage_id)
    REFERENCES public.pipeline_stages(account_id, pipeline_id, id)
    ON DELETE CASCADE;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_current_stage_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions DROP CONSTRAINT deal_stage_suggestions_current_stage_id_fkey;
  END IF;

  ALTER TABLE public.deal_stage_suggestions
    ADD CONSTRAINT deal_stage_suggestions_current_stage_id_fkey
    FOREIGN KEY (account_id, pipeline_id, current_stage_id)
    REFERENCES public.pipeline_stages(account_id, pipeline_id, id)
    ON DELETE CASCADE;
END $$;

CREATE INDEX IF NOT EXISTS idx_deal_stage_sugg_account_pipeline_suggested
  ON public.deal_stage_suggestions(account_id, pipeline_id, suggested_stage_id);

CREATE INDEX IF NOT EXISTS idx_deal_stage_sugg_account_pipeline_current
  ON public.deal_stage_suggestions(account_id, pipeline_id, current_stage_id);

CREATE INDEX IF NOT EXISTS idx_deal_stage_sugg_account_pipeline_deal
  ON public.deal_stage_suggestions(account_id, pipeline_id, deal_id);

-- ------------------------------------------------------------
-- 7. TRIGGER FUNCTION PRIVILEGE HARDENING
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.trg_pipeline_stages_account_id_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_pipeline_stages_account_id_sync() FROM anon;
REVOKE ALL ON FUNCTION public.trg_pipeline_stages_account_id_sync() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trg_pipeline_stages_account_id_sync() TO service_role;

REVOKE ALL ON FUNCTION public.trg_deal_stage_suggestions_pipeline_id_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_deal_stage_suggestions_pipeline_id_sync() FROM anon;
REVOKE ALL ON FUNCTION public.trg_deal_stage_suggestions_pipeline_id_sync() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trg_deal_stage_suggestions_pipeline_id_sync() TO service_role;
