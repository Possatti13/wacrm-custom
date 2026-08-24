-- ============================================================
-- Migration 056: Security, Search Path & Privilege Hardening (Phase 7B)
--
-- Comprehensive security hardening for PostgreSQL functions and RPCs:
-- 1. Search path immutability (SET search_path = public, pg_catalog).
-- 2. Principle of least privilege: Revoke public execution from internal,
--    worker, and trigger functions.
-- 3. Restrict worker and queue RPCs strictly to `service_role`.
-- 4. Restrict authenticated client RPCs to `authenticated` and `service_role`.
-- 5. Preserve intentional anonymous access strictly for `peek_invitation`.
-- ============================================================

-- ============================================================
-- SECTION 1: SEARCH PATH HARDENING FOR TRIGGER & HELPER FUNCTIONS
-- ============================================================

-- 1.1 updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- 1.2 ai_configs updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_ai_configs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_ai_configs_updated_at() FROM PUBLIC, anon, authenticated;

-- 1.3 ai_knowledge_documents updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_ai_knowledge_documents_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_ai_knowledge_documents_updated_at() FROM PUBLIC, anon, authenticated;

-- 1.4 Broadcast status column mapper (helper)
CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$;

REVOKE ALL ON FUNCTION public._bcast_cols_for_status(TEXT) FROM PUBLIC, anon, authenticated;

-- 1.5 Broadcast bump delta helper
CREATE OR REPLACE FUNCTION public._bcast_bump(bid UUID, col TEXT, delta INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  EXECUTE format(
    'UPDATE broadcasts SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, bid;
END;
$$;

REVOKE ALL ON FUNCTION public._bcast_bump(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bcast_bump(UUID, TEXT, INT) TO service_role;

-- 1.6 Normalize objection helper
CREATE OR REPLACE FUNCTION public.normalize_objection(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.lower(
          pg_catalog.translate(
            pg_catalog.btrim(COALESCE(p_text, '')),
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
          )
        ),
        '[^a-z0-9\s]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.normalize_objection(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_objection(TEXT) TO authenticated, service_role;

-- 1.7 Prevent rule key rename trigger function
CREATE OR REPLACE FUNCTION public.prevent_rule_key_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.rule_key <> NEW.rule_key THEN
    RAISE EXCEPTION 'rule_key is immutable and cannot be renamed. Archive old rule and create a new rule key instead.'
      USING ERRCODE = '22000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_rule_key_rename() FROM PUBLIC, anon, authenticated;

-- 1.8 Prevent immutable ledger mutations trigger function
CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Immutable ledger: UPDATE and DELETE operations are forbidden'
    USING ERRCODE = '22000';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_ledger_mutation() FROM PUBLIC, anon, authenticated;

-- 1.9 Protect conversation insights immutability trigger function
CREATE OR REPLACE FUNCTION public.trg_protect_conversation_insights_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
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
    RAISE EXCEPTION 'Invalid status transition: once % an insight cannot transition to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'superseded', 'retracted') THEN
    RAISE EXCEPTION 'Invalid status transition from active to %', NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'superseded' AND NEW.superseded_by_insight_id IS NULL THEN
    RAISE EXCEPTION 'superseded_by_insight_id is required when status is superseded'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'retracted' AND (NEW.retracted_at IS NULL OR NEW.retracted_reason IS NULL) THEN
    RAISE EXCEPTION 'retracted_at and retracted_reason are required when status is retracted'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_conversation_insights_immutability() FROM PUBLIC, anon, authenticated;

-- 1.10 Protect commercial config immutability trigger function
CREATE OR REPLACE FUNCTION public.trg_protect_commercial_config_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_TABLE_NAME = 'commercial_intents' THEN
    IF NEW.key <> OLD.key THEN
      RAISE EXCEPTION 'Key on commercial_intents is immutable after creation'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'commercial_attribute_definitions' THEN
    IF NEW.key <> OLD.key THEN
      RAISE EXCEPTION 'Key on commercial_attribute_definitions is immutable after creation'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.value_type <> OLD.value_type THEN
      RAISE EXCEPTION 'value_type on commercial_attribute_definitions is immutable after creation. Archive and create a new attribute instead.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'tenant_config_revisions' THEN
    RAISE EXCEPTION 'tenant_config_revisions is an append-only immutable ledger. Updates and deletes are forbidden.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_commercial_config_immutability() FROM PUBLIC, anon, authenticated;

-- 1.11 Auth & Inbound triggers search path and grants
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE ALL ON FUNCTION public.broadcast_recipient_aggregate_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_recipient_aggregate_trigger() TO service_role;

REVOKE ALL ON FUNCTION public.notify_conversation_assigned() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_conversation_assigned() TO service_role;

REVOKE ALL ON FUNCTION public.enforce_profile_privilege_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_profile_privilege_columns() TO service_role;

REVOKE ALL ON FUNCTION public.trg_after_customer_message_insert_enqueue_intelligence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_after_customer_message_insert_enqueue_intelligence() TO service_role;


-- ============================================================
-- SECTION 2: INTERNAL HELPERS & WORKER/QUEUE RPCS (SERVICE_ROLE ONLY)
-- ============================================================

-- 2.1 Internal snapshot and context generators
REVOKE ALL ON FUNCTION public.generate_tenant_config_snapshot_internal(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_tenant_config_snapshot_internal(UUID, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.get_or_create_tenant_catalog_context(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_tenant_catalog_context(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts() TO service_role;

-- 2.2 Execution counters & automation helpers
REVOKE ALL ON FUNCTION public.increment_automation_execution_count(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_automation_execution_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.increment_flow_execution_count(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_flow_execution_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(UUID, INT) TO service_role;

REVOKE ALL ON FUNCTION public.record_webhook_failure(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(UUID, INT) TO service_role;

-- 2.3 WhatsApp Inbound Queue RPCs
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_inbound_batch(JSONB[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_inbound_batch(JSONB[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_whatsapp_inbound(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_whatsapp_inbound(INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.set_whatsapp_inbound_visibility(BIGINT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_inbound_visibility(BIGINT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.archive_whatsapp_inbound(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_whatsapp_inbound(BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.dead_letter_whatsapp_inbound(BIGINT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dead_letter_whatsapp_inbound(BIGINT, JSONB, JSONB) TO service_role;

-- 2.4 Intelligence Extraction Queue RPCs
REVOKE ALL ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.read_intelligence_extraction(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_intelligence_extraction(INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.set_intelligence_extraction_visibility(BIGINT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_intelligence_extraction_visibility(BIGINT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.archive_intelligence_extraction(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_intelligence_extraction(BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.dead_letter_intelligence_extraction(BIGINT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dead_letter_intelligence_extraction(BIGINT, JSONB, JSONB) TO service_role;

-- 2.5 Intelligence Run Management & Engine Persistence
REVOKE ALL ON FUNCTION public.claim_conversation_analysis_run(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversation_analysis_run(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.fail_conversation_analysis_run(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_conversation_analysis_run(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.persist_conversation_analysis_batch(UUID, UUID, UUID, TEXT, JSONB, UUID[], UUID, TIMESTAMPTZ, INT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_conversation_analysis_batch(UUID, UUID, UUID, TEXT, JSONB, UUID[], UUID, TIMESTAMPTZ, INT, INT, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.project_contact_commercial_state(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_contact_commercial_state(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_and_persist_contact_score(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_and_persist_contact_score(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.recalculate_tenant_lead_scores_batch(UUID, UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_tenant_lead_scores_batch(UUID, UUID, UUID, INT) TO service_role;


-- ============================================================
-- SECTION 3: AUTHENTICATED CLIENT RPCS (AUTHENTICATED + SERVICE_ROLE)
-- ============================================================

-- 3.1 Membership helper (Used by RLS policies)
REVOKE ALL ON FUNCTION public.is_account_member(UUID, public.account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, public.account_role_enum) TO authenticated, service_role;

-- 3.2 Account management & Presence
REVOKE ALL ON FUNCTION public.set_member_role(UUID, public.account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, public.account_role_enum) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.touch_presence(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(UUID) TO authenticated, service_role;

-- 3.3 AI Knowledge Retrieval (Search path update with extensions fallback)
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  UUID,
  p_query       TEXT,
  p_match_count INT
)
RETURNS TABLE (id UUID, content TEXT, rank REAL)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, INT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id      UUID,
  p_query_embedding TEXT,
  p_match_count     INT
)
RETURNS TABLE (id UUID, content TEXT, distance REAL)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, INT) TO authenticated, service_role;

-- 3.4 Catalog Transactional RPCs
REVOKE ALL ON FUNCTION public.create_catalog_item_with_terms(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_catalog_item_with_terms(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_catalog_item_with_canonical(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_catalog_item_with_canonical(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB, BOOLEAN) TO authenticated, service_role;

-- 3.5 Commercial Insight Correction & Retraction
REVOKE ALL ON FUNCTION public.supersede_conversation_insight(UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supersede_conversation_insight(UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, NUMERIC, TEXT, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.supersede_conversation_insight(UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supersede_conversation_insight(UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, NUMERIC, TEXT, TEXT, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.retract_conversation_insight(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retract_conversation_insight(UUID, UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_project_commercial_state(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_project_commercial_state(UUID, UUID, TEXT) TO authenticated, service_role;

-- 3.6 Tenant Commercial Configuration RPCs
REVOKE ALL ON FUNCTION public.save_commercial_intent(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_commercial_intent(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INT, JSONB, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_commercial_attribute_definition(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, INT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_commercial_attribute_definition(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, INT, JSONB, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_tenant_commercial_context(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_commercial_context(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_tenant_commercial_terminology(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_commercial_terminology(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;

-- 3.7 Lead Scoring & Tenant Intelligence Settings RPCs
REVOKE ALL ON FUNCTION public.save_lead_scoring_configuration(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_lead_scoring_configuration(UUID, JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_tenant_intelligence_settings(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_intelligence_settings(UUID, JSONB) TO authenticated, service_role;


-- ============================================================
-- SECTION 4: INTENTIONALLY ANONYMOUS RPC
-- ============================================================

-- 4.1 Peek Invitation (Must remain accessible to unauthenticated callers)
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated, service_role;
