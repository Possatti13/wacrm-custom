-- ============================================================
-- Migration 060: Pipeline Domain Multi-Tenant & Referential Hardening
--
-- Enforces physical database-level structural invariants across:
--   1. pipelines (account_id, id)
--   2. pipeline_stages (account_id, pipeline_id, id)
--   3. deals (account_id, pipeline_id, stage_id, contact_id, conversation_id)
--   4. deal_stage_suggestions (account_id, deal_id, suggested_stage_id, current_stage_id)
--   5. tasks (account_id, deal_id)
--
-- Guarantees PostgreSQL rejects cross-tenant and cross-pipeline references
-- at constraint level, independent of RLS.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PIPELINES (Composite Unique)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_pipelines_account_id_id' AND conrelid = 'public.pipelines'::regclass
  ) THEN
    ALTER TABLE public.pipelines
      ADD CONSTRAINT uq_pipelines_account_id_id UNIQUE (account_id, id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. PIPELINE STAGES (account_id + Composite Constraints + Trigger)
-- ------------------------------------------------------------
-- Add account_id column if not exists
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

-- Backfill account_id from pipelines
UPDATE public.pipeline_stages ps
SET account_id = p.account_id
FROM public.pipelines p
WHERE ps.pipeline_id = p.id
  AND ps.account_id IS NULL;

-- Enforce NOT NULL on account_id
ALTER TABLE public.pipeline_stages
  ALTER COLUMN account_id SET NOT NULL;

-- Trigger to auto-sync account_id from pipeline_id on insert if omitted
CREATE OR REPLACE FUNCTION public.trg_pipeline_stages_account_id_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    SELECT account_id INTO NEW.account_id
    FROM public.pipelines
    WHERE id = NEW.pipeline_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_stages_account_id_sync ON public.pipeline_stages;
CREATE TRIGGER trg_pipeline_stages_account_id_sync
  BEFORE INSERT ON public.pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_pipeline_stages_account_id_sync();

-- Composite unique and foreign key constraints on pipeline_stages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_pipeline_stages_account_id_id' AND conrelid = 'public.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE public.pipeline_stages
      ADD CONSTRAINT uq_pipeline_stages_account_id_id UNIQUE (account_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_pipeline_stages_account_pipeline_id' AND conrelid = 'public.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE public.pipeline_stages
      ADD CONSTRAINT uq_pipeline_stages_account_pipeline_id UNIQUE (account_id, pipeline_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_pipeline_stages_pipeline_account' AND conrelid = 'public.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE public.pipeline_stages
      ADD CONSTRAINT fk_pipeline_stages_pipeline_account
      FOREIGN KEY (account_id, pipeline_id)
      REFERENCES public.pipelines(account_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Update RLS policies on pipeline_stages to use direct account_id lookup
DROP POLICY IF EXISTS pipeline_stages_select ON public.pipeline_stages;
CREATE POLICY pipeline_stages_select ON public.pipeline_stages
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS pipeline_stages_modify ON public.pipeline_stages;
DROP POLICY IF EXISTS pipeline_stages_insert ON public.pipeline_stages;
CREATE POLICY pipeline_stages_insert ON public.pipeline_stages
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS pipeline_stages_update ON public.pipeline_stages;
CREATE POLICY pipeline_stages_update ON public.pipeline_stages
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS pipeline_stages_delete ON public.pipeline_stages;
CREATE POLICY pipeline_stages_delete ON public.pipeline_stages
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Covering index on pipeline_stages
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_account_pipeline_pos
  ON public.pipeline_stages(account_id, pipeline_id, position);

-- ------------------------------------------------------------
-- 3. DEALS (Composite Unique & Composite Foreign Keys)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_deals_account_id_id' AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT uq_deals_account_id_id UNIQUE (account_id, id);
  END IF;

  -- Pipeline FK (same account)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_deals_pipeline_account' AND conrelid = 'public.deals'::regclass
  ) THEN
    -- Drop legacy single-column FK if exists
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'deals_pipeline_id_fkey' AND conrelid = 'public.deals'::regclass
    ) THEN
      ALTER TABLE public.deals DROP CONSTRAINT deals_pipeline_id_fkey;
    END IF;

    ALTER TABLE public.deals
      ADD CONSTRAINT fk_deals_pipeline_account
      FOREIGN KEY (account_id, pipeline_id)
      REFERENCES public.pipelines(account_id, id)
      ON DELETE CASCADE;
  END IF;

  -- Stage FK (same account AND same pipeline)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_deals_stage_account_pipeline' AND conrelid = 'public.deals'::regclass
  ) THEN
    -- Drop legacy single-column FK if exists
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'deals_stage_id_fkey' AND conrelid = 'public.deals'::regclass
    ) THEN
      ALTER TABLE public.deals DROP CONSTRAINT deals_stage_id_fkey;
    END IF;

    ALTER TABLE public.deals
      ADD CONSTRAINT fk_deals_stage_account_pipeline
      FOREIGN KEY (account_id, pipeline_id, stage_id)
      REFERENCES public.pipeline_stages(account_id, pipeline_id, id)
      ON DELETE RESTRICT;
  END IF;

  -- Contact FK (same account)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_deals_contact_account' AND conrelid = 'public.deals'::regclass
  ) THEN
    -- Drop legacy single-column FK if exists
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'deals_contact_id_fkey' AND conrelid = 'public.deals'::regclass
    ) THEN
      ALTER TABLE public.deals DROP CONSTRAINT deals_contact_id_fkey;
    END IF;

    ALTER TABLE public.deals
      ADD CONSTRAINT fk_deals_contact_account
      FOREIGN KEY (account_id, contact_id)
      REFERENCES public.contacts(account_id, id)
      ON DELETE SET NULL;
  END IF;

  -- Conversation FK (same account)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_deals_conversation_account' AND conrelid = 'public.deals'::regclass
  ) THEN
    -- Drop legacy single-column FK if exists
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'deals_conversation_id_fkey' AND conrelid = 'public.deals'::regclass
    ) THEN
      ALTER TABLE public.deals DROP CONSTRAINT deals_conversation_id_fkey;
    END IF;

    ALTER TABLE public.deals
      ADD CONSTRAINT fk_deals_conversation_account
      FOREIGN KEY (account_id, conversation_id)
      REFERENCES public.conversations(account_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Covering indexes on deals
CREATE INDEX IF NOT EXISTS idx_deals_account_pipeline_stage
  ON public.deals(account_id, pipeline_id, stage_id);

CREATE INDEX IF NOT EXISTS idx_deals_account_contact
  ON public.deals(account_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_deals_account_conversation
  ON public.deals(account_id, conversation_id);

-- ------------------------------------------------------------
-- 4. DEAL STAGE SUGGESTIONS (Composite Foreign Keys)
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Deal FK (same account)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_deal_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions
      DROP CONSTRAINT deal_stage_suggestions_deal_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_deal_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions
      ADD CONSTRAINT deal_stage_suggestions_deal_id_fkey
      FOREIGN KEY (account_id, deal_id)
      REFERENCES public.deals(account_id, id)
      ON DELETE CASCADE;
  END IF;

  -- Suggested Stage FK (same account)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_suggested_stage_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions
      DROP CONSTRAINT deal_stage_suggestions_suggested_stage_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_suggested_stage_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions
      ADD CONSTRAINT deal_stage_suggestions_suggested_stage_id_fkey
      FOREIGN KEY (account_id, suggested_stage_id)
      REFERENCES public.pipeline_stages(account_id, id)
      ON DELETE CASCADE;
  END IF;

  -- Current Stage FK (same account)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_current_stage_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions
      DROP CONSTRAINT deal_stage_suggestions_current_stage_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stage_suggestions_current_stage_id_fkey' AND conrelid = 'public.deal_stage_suggestions'::regclass
  ) THEN
    ALTER TABLE public.deal_stage_suggestions
      ADD CONSTRAINT deal_stage_suggestions_current_stage_id_fkey
      FOREIGN KEY (account_id, current_stage_id)
      REFERENCES public.pipeline_stages(account_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Covering indexes on deal_stage_suggestions
CREATE INDEX IF NOT EXISTS idx_deal_stage_sugg_account_suggested_stage
  ON public.deal_stage_suggestions(account_id, suggested_stage_id);

CREATE INDEX IF NOT EXISTS idx_deal_stage_sugg_account_current_stage
  ON public.deal_stage_suggestions(account_id, current_stage_id);

-- ------------------------------------------------------------
-- 5. TASKS (Composite FK to Deals)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_deal' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_deal;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_deal_id_fkey' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_deal_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_deal_same_account' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_deal_same_account
      FOREIGN KEY (account_id, deal_id)
      REFERENCES public.deals(account_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. HARDENED TRANSACTIONAL RPCS
-- ------------------------------------------------------------

-- Apply Deal Stage Suggestion (with multi-tenant + pipeline coherence checks)
CREATE OR REPLACE FUNCTION public.apply_deal_stage_suggestion(
  p_account_id UUID,
  p_suggestion_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_suggestion RECORD;
  v_deal RECORD;
  v_stage RECORD;
BEGIN
  -- 1. Authorize tenant membership
  IF NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Access denied: agent role required for account %', p_account_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lock and retrieve suggestion within tenant
  SELECT * INTO v_suggestion
  FROM public.deal_stage_suggestions
  WHERE account_id = p_account_id
    AND id = p_suggestion_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending stage suggestion % not found in account %', p_suggestion_id, p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Lock and retrieve deal within tenant
  SELECT * INTO v_deal
  FROM public.deals
  WHERE account_id = p_account_id
    AND id = v_suggestion.deal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal % not found in account %', v_suggestion.deal_id, p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Verify suggested stage exists in same account AND belongs to deal pipeline
  SELECT * INTO v_stage
  FROM public.pipeline_stages
  WHERE account_id = p_account_id
    AND id = v_suggestion.suggested_stage_id
    AND pipeline_id = v_deal.pipeline_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suggested stage % does not belong to pipeline % in account %',
      v_suggestion.suggested_stage_id, v_deal.pipeline_id, p_account_id
      USING ERRCODE = '23503';
  END IF;

  -- 5. Atomic deal update
  UPDATE public.deals
  SET stage_id = v_suggestion.suggested_stage_id,
      updated_at = now()
  WHERE account_id = p_account_id
    AND id = v_suggestion.deal_id
  RETURNING * INTO v_deal;

  -- 6. Atomic suggestion status update
  UPDATE public.deal_stage_suggestions
  SET status = 'applied',
      updated_at = now()
  WHERE account_id = p_account_id
    AND id = p_suggestion_id;

  RETURN to_jsonb(v_deal);
END;
$$;

-- Dismiss Deal Stage Suggestion
CREATE OR REPLACE FUNCTION public.dismiss_deal_stage_suggestion(
  p_account_id UUID,
  p_suggestion_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- 1. Authorize tenant membership
  IF NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Access denied: agent role required for account %', p_account_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Update status to dismissed
  UPDATE public.deal_stage_suggestions
  SET status = 'dismissed',
      updated_at = now()
  WHERE account_id = p_account_id
    AND id = p_suggestion_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending stage suggestion % not found in account %', p_suggestion_id, p_account_id
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 7. FUNCTION & TABLE GRANTS
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_deal_stage_suggestion(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_deal_stage_suggestion(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_deal_stage_suggestion(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.dismiss_deal_stage_suggestion(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_deal_stage_suggestion(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.dismiss_deal_stage_suggestion(UUID, UUID) TO authenticated, service_role;

GRANT ALL ON public.pipeline_stages TO service_role;
GRANT ALL ON public.deals TO service_role;
GRANT ALL ON public.deal_stage_suggestions TO service_role;
GRANT ALL ON public.tasks TO service_role;
