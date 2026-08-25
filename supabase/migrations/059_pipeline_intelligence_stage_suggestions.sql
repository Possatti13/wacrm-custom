-- ============================================================
-- Migration 059: Pipeline Intelligence & Stage Suggestions (Phase 10)
--
-- Enables proactive stage transition recommendations on deals based
-- on factual conversation signals with one-click human confirmation.
-- ============================================================

-- 1. DEAL STAGE SUGGESTIONS TABLE
CREATE TABLE IF NOT EXISTS public.deal_stage_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  suggested_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  current_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  reason TEXT NOT NULL,
  confidence NUMERIC(4, 3) CHECK (confidence >= 0 AND confidence <= 1),
  insight_id UUID REFERENCES public.conversation_insights(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_deal_stage_suggestions_account_id UNIQUE (account_id, id)
);

-- 2. COVERING INDEXES
CREATE INDEX IF NOT EXISTS idx_deal_stage_sugg_account_deal_status
  ON public.deal_stage_suggestions(account_id, deal_id, status);

CREATE INDEX IF NOT EXISTS idx_deal_stage_sugg_account_status
  ON public.deal_stage_suggestions(account_id, status);

-- 3. ROW LEVEL SECURITY
ALTER TABLE public.deal_stage_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_stage_suggestions_select ON public.deal_stage_suggestions;
CREATE POLICY deal_stage_suggestions_select ON public.deal_stage_suggestions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS deal_stage_suggestions_insert ON public.deal_stage_suggestions;
CREATE POLICY deal_stage_suggestions_insert ON public.deal_stage_suggestions
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_stage_suggestions_update ON public.deal_stage_suggestions;
CREATE POLICY deal_stage_suggestions_update ON public.deal_stage_suggestions
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_stage_suggestions_delete ON public.deal_stage_suggestions;
CREATE POLICY deal_stage_suggestions_delete ON public.deal_stage_suggestions
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 4. TRIGGER FOR UPDATED_AT
DROP TRIGGER IF EXISTS trg_deal_stage_suggestions_updated_at ON public.deal_stage_suggestions;
CREATE TRIGGER trg_deal_stage_suggestions_updated_at
  BEFORE UPDATE ON public.deal_stage_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. ATOMIC RPC: APPLY STAGE SUGGESTION
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
BEGIN
  -- Authorize tenant membership
  IF NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Access denied: agent role required for account %', p_account_id
      USING ERRCODE = '42501';
  END IF;

  -- Lock and retrieve suggestion
  SELECT * INTO v_suggestion
  FROM public.deal_stage_suggestions
  WHERE account_id = p_account_id
    AND id = p_suggestion_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending stage suggestion not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Update deal stage
  UPDATE public.deals
  SET stage_id = v_suggestion.suggested_stage_id,
      updated_at = now()
  WHERE account_id = p_account_id
    AND id = v_suggestion.deal_id
  RETURNING * INTO v_deal;

  -- Mark suggestion applied
  UPDATE public.deal_stage_suggestions
  SET status = 'applied',
      updated_at = now()
  WHERE account_id = p_account_id
    AND id = p_suggestion_id;

  RETURN to_jsonb(v_deal);
END;
$$;

-- 6. ATOMIC RPC: DISMISS STAGE SUGGESTION
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
  IF NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Access denied: agent role required for account %', p_account_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.deal_stage_suggestions
  SET status = 'dismissed',
      updated_at = now()
  WHERE account_id = p_account_id
    AND id = p_suggestion_id
    AND status = 'pending';
END;
$$;

-- 7. GRANTS
REVOKE ALL ON public.deal_stage_suggestions FROM PUBLIC;
REVOKE ALL ON public.deal_stage_suggestions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_stage_suggestions TO authenticated;

REVOKE ALL ON FUNCTION public.apply_deal_stage_suggestion(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_deal_stage_suggestion(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_deal_stage_suggestion(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.dismiss_deal_stage_suggestion(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_deal_stage_suggestion(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.dismiss_deal_stage_suggestion(UUID, UUID) TO authenticated;

GRANT ALL ON public.deal_stage_suggestions TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
