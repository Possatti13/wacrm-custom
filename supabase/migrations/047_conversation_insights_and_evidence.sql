-- ============================================================
-- Migration 047: Conversation Insights, Evidence & Analysis State (Phase 3C)
--
-- 1. Pre-requisite unique constraints on conversations and messages
--    to support composite foreign keys for cross-tenant & cross-conversation isolation.
-- 2. conversation_analysis_runs (ledger of analysis execution).
-- 3. conversation_analysis_messages (versioned processed-message ledger against late arrivals).
-- 4. conversation_analysis_state (checkpoint per conversation and extractor version).
-- 5. conversation_insights (append-mostly factual insights with active-scoped dedupe keys).
-- 6. conversation_insight_evidence (spans and message linking restricted to the same conversation).
-- 7. Controlled RPCs: supersede_conversation_insight and retract_conversation_insight.
-- 8. Immutability trigger and strict RLS policies.
-- ============================================================

-- 1. Pre-requisites
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_conversations_account_id_id'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT uq_conversations_account_id_id UNIQUE (account_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_messages_conversation_id_id'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT uq_messages_conversation_id_id UNIQUE (conversation_id, id);
  END IF;
END $$;


-- 2. CONVERSATION_ANALYSIS_RUNS (Ledger)
CREATE TABLE IF NOT EXISTS public.conversation_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

  from_cursor_timestamp TIMESTAMPTZ,
  from_cursor_message_id UUID,
  to_cursor_timestamp TIMESTAMPTZ,
  to_cursor_message_id UUID,

  messages_count INTEGER NOT NULL DEFAULT 0,
  insights_count INTEGER NOT NULL DEFAULT 0,

  extractor_version TEXT NOT NULL DEFAULT 'v1',
  provider TEXT,
  model TEXT,

  error_code TEXT,
  error_message TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_conversation_analysis_runs_account_conv_id
    UNIQUE (account_id, conversation_id, id),
  CONSTRAINT fk_conversation_analysis_runs_conversation_same_account
    FOREIGN KEY (account_id, conversation_id)
    REFERENCES public.conversations(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_analysis_runs_lookup
  ON public.conversation_analysis_runs(account_id, conversation_id, status);

ALTER TABLE public.conversation_analysis_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_analysis_runs_select ON public.conversation_analysis_runs;
CREATE POLICY conversation_analysis_runs_select ON public.conversation_analysis_runs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

-- Processing ledger is server-only (no direct client INSERT/UPDATE/DELETE)


-- 3. CONVERSATION_ANALYSIS_MESSAGES (Versioned Processed-Message Ledger)
CREATE TABLE IF NOT EXISTS public.conversation_analysis_messages (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  extractor_version TEXT NOT NULL DEFAULT 'v1',
  analysis_run_id UUID NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (conversation_id, message_id, extractor_version),
  CONSTRAINT fk_conversation_analysis_messages_run
    FOREIGN KEY (account_id, conversation_id, analysis_run_id)
    REFERENCES public.conversation_analysis_runs(account_id, conversation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_conversation_analysis_messages_message
    FOREIGN KEY (conversation_id, message_id)
    REFERENCES public.messages(conversation_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_conversation_analysis_messages_lookup
  ON public.conversation_analysis_messages(account_id, conversation_id, extractor_version);

ALTER TABLE public.conversation_analysis_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_analysis_messages_select ON public.conversation_analysis_messages;
CREATE POLICY conversation_analysis_messages_select ON public.conversation_analysis_messages
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 4. CONVERSATION_ANALYSIS_STATE (Versioned Checkpoint)
CREATE TABLE IF NOT EXISTS public.conversation_analysis_state (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  extractor_version TEXT NOT NULL DEFAULT 'v1',

  last_analyzed_message_created_at TIMESTAMPTZ,
  last_analyzed_message_id UUID,
  last_analysis_run_id UUID,

  last_analyzed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (conversation_id, extractor_version),
  CONSTRAINT fk_conversation_analysis_state_conversation_same_account
    FOREIGN KEY (account_id, conversation_id)
    REFERENCES public.conversations(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_conversation_analysis_state_run_same_conversation
    FOREIGN KEY (account_id, conversation_id, last_analysis_run_id)
    REFERENCES public.conversation_analysis_runs(account_id, conversation_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_conversation_analysis_state_account
  ON public.conversation_analysis_state(account_id);

ALTER TABLE public.conversation_analysis_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_analysis_state_select ON public.conversation_analysis_state;
CREATE POLICY conversation_analysis_state_select ON public.conversation_analysis_state
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 5. CONVERSATION_INSIGHTS (Factual Append-Mostly)
CREATE TABLE IF NOT EXISTS public.conversation_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,

  insight_type TEXT NOT NULL CHECK (
    insight_type IN ('interest', 'objection', 'intent', 'urgency', 'sentiment', 'next_action', 'summary', 'attribute')
  ),

  value_text TEXT,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  catalog_item_id UUID,

  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),

  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'intelligence', 'system')),

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted')),
  supersedes_insight_id UUID,
  retracted_reason TEXT,

  analysis_run_id UUID,
  dedupe_key TEXT,

  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_conversation_insights_account_conv_id
    UNIQUE (account_id, conversation_id, id),
  CONSTRAINT fk_conversation_insights_conversation_same_account
    FOREIGN KEY (account_id, conversation_id)
    REFERENCES public.conversations(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_conversation_insights_run_same_conversation
    FOREIGN KEY (account_id, conversation_id, analysis_run_id)
    REFERENCES public.conversation_analysis_runs(account_id, conversation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_conversation_insights_supersede_same_conversation
    FOREIGN KEY (account_id, conversation_id, supersedes_insight_id)
    REFERENCES public.conversation_insights(account_id, conversation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_conversation_insights_catalog_item_same_account
    FOREIGN KEY (account_id, catalog_item_id)
    REFERENCES public.catalog_items(account_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_conversation_insights_interest_item_or_text
    CHECK (insight_type <> 'interest' OR catalog_item_id IS NOT NULL OR (value_text IS NOT NULL AND length(trim(value_text)) > 0)),
  CONSTRAINT chk_conversation_insights_retracted_coherence
    CHECK ((status = 'retracted' AND retracted_reason IS NOT NULL AND length(trim(retracted_reason)) > 0) OR (status <> 'retracted' AND retracted_reason IS NULL))
);

-- Unique constraint for active dedupe keys (superseded/retracted insights do not block future active successors)
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_insights_active_dedupe
  ON public.conversation_insights (account_id, conversation_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_conversation_insights_lookup
  ON public.conversation_insights(account_id, conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_conversation_insights_type
  ON public.conversation_insights(account_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_conversation_insights_catalog_item
  ON public.conversation_insights(account_id, catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;

-- Trigger to protect factual immutability and valid state transitions
CREATE OR REPLACE FUNCTION public.trg_protect_conversation_insights_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Factual columns are strictly immutable
  IF NEW.insight_type <> OLD.insight_type
     OR NEW.value_text IS DISTINCT FROM OLD.value_text
     OR NEW.value_json IS DISTINCT FROM OLD.value_json
     OR NEW.catalog_item_id IS DISTINCT FROM OLD.catalog_item_id
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.source <> OLD.source
     OR NEW.observed_at <> OLD.observed_at
     OR NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.supersedes_insight_id IS DISTINCT FROM OLD.supersedes_insight_id
     OR NEW.conversation_id <> OLD.conversation_id
     OR NEW.account_id <> OLD.account_id
     OR NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Immutable factual fields on conversation_insights cannot be modified. Use supersede or retract.'
      USING ERRCODE = '23514';
  END IF;

  -- 2. State transition rules: superseded and retracted are terminal states
  IF OLD.status IN ('superseded', 'retracted') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Cannot transition insight from terminal status % to %', OLD.status, NEW.status
      USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_insights_immutability ON public.conversation_insights;
CREATE TRIGGER trg_conversation_insights_immutability
  BEFORE UPDATE ON public.conversation_insights
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_conversation_insights_immutability();

ALTER TABLE public.conversation_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_insights_select ON public.conversation_insights;
CREATE POLICY conversation_insights_select ON public.conversation_insights
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS conversation_insights_insert ON public.conversation_insights;
CREATE POLICY conversation_insights_insert ON public.conversation_insights
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- No direct client UPDATE or DELETE policy (mutations via controlled RPCs and service_role)


-- 6. CONVERSATION_INSIGHT_EVIDENCE (Spans & Messages)
CREATE TABLE IF NOT EXISTS public.conversation_insight_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  insight_id UUID NOT NULL,
  message_id UUID NOT NULL,

  start_offset INTEGER,
  end_offset INTEGER,
  snippet TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_conversation_insight_evidence_insight_same_conversation
    FOREIGN KEY (account_id, conversation_id, insight_id)
    REFERENCES public.conversation_insights(account_id, conversation_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_conversation_insight_evidence_message_same_conversation
    FOREIGN KEY (conversation_id, message_id)
    REFERENCES public.messages(conversation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_conversation_insight_evidence_spans
    CHECK (
      (start_offset IS NULL AND end_offset IS NULL)
      OR
      (start_offset IS NOT NULL AND end_offset IS NOT NULL AND start_offset >= 0 AND end_offset > start_offset)
    )
);

-- Allows multiple distinct spans on the same message for the same insight, but prevents exact duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_insight_evidence_exact_span
  ON public.conversation_insight_evidence (
    account_id,
    insight_id,
    message_id,
    COALESCE(start_offset, -1),
    COALESCE(end_offset, -1)
  );

CREATE INDEX IF NOT EXISTS idx_conversation_insight_evidence_lookup
  ON public.conversation_insight_evidence(account_id, insight_id);
CREATE INDEX IF NOT EXISTS idx_conversation_insight_evidence_message
  ON public.conversation_insight_evidence(conversation_id, message_id);

ALTER TABLE public.conversation_insight_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_insight_evidence_select ON public.conversation_insight_evidence;
CREATE POLICY conversation_insight_evidence_select ON public.conversation_insight_evidence
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS conversation_insight_evidence_insert ON public.conversation_insight_evidence;
CREATE POLICY conversation_insight_evidence_insert ON public.conversation_insight_evidence
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- No direct client UPDATE or DELETE for evidence


-- 7. CONTROLLED RPCs (SUPERSEDE & RETRACT)

-- 7A. SUPERSEDE RPC
CREATE OR REPLACE FUNCTION public.supersede_conversation_insight(
  p_account_id UUID,
  p_conversation_id UUID,
  p_original_insight_id UUID,
  p_new_insight_type TEXT,
  p_new_value_text TEXT,
  p_new_value_json JSONB,
  p_new_catalog_item_id UUID,
  p_new_confidence NUMERIC,
  p_new_source TEXT,
  p_new_dedupe_key TEXT,
  p_evidence JSONB -- array of { message_id, start_offset, end_offset, snippet }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orig RECORD;
  v_new_id UUID;
  v_ev JSONB;
BEGIN
  -- 1. Caller Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions for account %', p_account_id
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lock and validate original insight
  SELECT * INTO v_orig
  FROM public.conversation_insights
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND id = p_original_insight_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original insight not found in account/conversation'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_orig.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot supersede an insight that is not active (current status: %)', v_orig.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Mark original insight as 'superseded' FIRST (frees active dedupe key slot)
  UPDATE public.conversation_insights
  SET status = 'superseded',
      updated_at = pg_catalog.now()
  WHERE id = p_original_insight_id;

  -- 4. Insert new insight with supersedes_insight_id link
  INSERT INTO public.conversation_insights (
    account_id,
    conversation_id,
    insight_type,
    value_text,
    value_json,
    catalog_item_id,
    confidence,
    source,
    status,
    supersedes_insight_id,
    dedupe_key,
    observed_at
  ) VALUES (
    p_account_id,
    p_conversation_id,
    p_new_insight_type,
    p_new_value_text,
    COALESCE(p_new_value_json, '{}'::jsonb),
    p_new_catalog_item_id,
    p_new_confidence,
    COALESCE(p_new_source, 'manual'),
    'active',
    p_original_insight_id,
    p_new_dedupe_key,
    pg_catalog.now()
  ) RETURNING id INTO v_new_id;

  -- 5. Insert evidence for the new insight
  IF p_evidence IS NOT NULL AND pg_catalog.jsonb_array_length(p_evidence) > 0 THEN
    FOR v_ev IN SELECT * FROM pg_catalog.jsonb_array_elements(p_evidence)
    LOOP
      INSERT INTO public.conversation_insight_evidence (
        account_id,
        conversation_id,
        insight_id,
        message_id,
        start_offset,
        end_offset,
        snippet
      ) VALUES (
        p_account_id,
        p_conversation_id,
        v_new_id,
        (v_ev->>'message_id')::uuid,
        (v_ev->>'start_offset')::integer,
        (v_ev->>'end_offset')::integer,
        v_ev->>'snippet'
      );
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'original_insight_id', p_original_insight_id,
    'new_insight_id', v_new_id,
    'status', 'superseded'
  );
END;
$$;


-- 7B. RETRACT RPC
CREATE OR REPLACE FUNCTION public.retract_conversation_insight(
  p_account_id UUID,
  p_conversation_id UUID,
  p_insight_id UUID,
  p_retracted_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orig RECORD;
BEGIN
  -- 1. Caller Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions for account %', p_account_id
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_retracted_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_retracted_reason)) = 0 THEN
    RAISE EXCEPTION 'Retracted reason is required'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Lock and validate original insight
  SELECT * INTO v_orig
  FROM public.conversation_insights
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND id = p_insight_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insight not found in account/conversation'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_orig.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot retract an insight that is not active (current status: %)', v_orig.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Mark as retracted
  UPDATE public.conversation_insights
  SET status = 'retracted',
      retracted_reason = pg_catalog.btrim(p_retracted_reason),
      updated_at = pg_catalog.now()
  WHERE id = p_insight_id;

  RETURN pg_catalog.jsonb_build_object(
    'insight_id', p_insight_id,
    'status', 'retracted'
  );
END;
$$;
