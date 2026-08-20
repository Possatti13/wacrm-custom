-- ============================================================
-- Migration 053: Lead Scoring Engine Hardening (Phase 6 Final)
--
-- 1. Enforces rule_key immutability on lead_scoring_rules (prevents rename).
-- 2. Transactional batch RPC for durable tenant-wide lead score sweep:
--    recalculate_tenant_lead_scores_batch(account_id, target_revision_id, after_contact_id, batch_size)
-- ============================================================

-- 1. PREVENT RULE KEY RENAME TRIGGER
CREATE OR REPLACE FUNCTION public.prevent_rule_key_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.rule_key <> NEW.rule_key THEN
    RAISE EXCEPTION 'rule_key is immutable and cannot be renamed. Archive old rule and create a new rule key instead.'
      USING ERRCODE = '22000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_scoring_rules_prevent_rename ON public.lead_scoring_rules;
CREATE TRIGGER trg_lead_scoring_rules_prevent_rename
  BEFORE UPDATE ON public.lead_scoring_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_rule_key_rename();


-- 2. DURABLE TENANT-WIDE RESCORE BATCH RPC
CREATE OR REPLACE FUNCTION public.recalculate_tenant_lead_scores_batch(
  p_account_id UUID,
  p_target_revision_id UUID,
  p_after_contact_id UUID DEFAULT NULL,
  p_batch_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cfg RECORD;
  v_contact RECORD;
  v_processed_count INTEGER := 0;
  v_last_contact_id UUID := NULL;
  v_has_more BOOLEAN := false;
  v_actual_batch_size INTEGER := COALESCE(p_batch_size, 50);
BEGIN
  -- 1. Authorization: service_role or admin
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Verify config & current revision match target revision
  SELECT * INTO v_cfg
  FROM public.lead_scoring_configs
  WHERE account_id = p_account_id;

  IF NOT FOUND OR NOT v_cfg.enabled OR v_cfg.current_revision_id <> p_target_revision_id THEN
    -- Obsolete job: target revision is no longer current or scoring is disabled
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'obsolete',
      'reason', 'target_revision_not_current',
      'processed_count', 0,
      'next_cursor', NULL,
      'is_obsolete', true
    );
  END IF;

  -- 3. Fetch batch of contacts ordered by ID
  FOR v_contact IN
    SELECT c.id
    FROM public.contacts c
    WHERE c.account_id = p_account_id
      AND (p_after_contact_id IS NULL OR c.id > p_after_contact_id)
    ORDER BY c.id ASC
    LIMIT v_actual_batch_size + 1
  LOOP
    IF v_processed_count < v_actual_batch_size THEN
      PERFORM public.calculate_and_persist_contact_score(
        p_account_id,
        v_contact.id,
        'tenant_revision_recompute'
      );
      v_last_contact_id := v_contact.id;
      v_processed_count := v_processed_count + 1;
    ELSE
      v_has_more := true;
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'processed',
    'processed_count', v_processed_count,
    'next_cursor', CASE WHEN v_has_more THEN v_last_contact_id ELSE NULL END,
    'is_obsolete', false
  );
END;
$$;
