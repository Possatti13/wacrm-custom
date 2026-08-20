-- ============================================================
-- Pilot & End-to-End Inspection Tool (Phase 7A)
--
-- Usage in psql / Supabase SQL Editor:
-- \set target_account_id 'YOUR-ACCOUNT-UUID'
-- \set target_conversation_id 'YOUR-CONVERSATION-UUID'
-- ============================================================

WITH target_conv AS (
  SELECT
    c.id AS conversation_id,
    c.account_id,
    c.contact_id,
    c.status AS conversation_status,
    c.unread_count,
    c.last_message_at,
    c.created_at AS conversation_created_at
  FROM public.conversations c
  WHERE c.account_id = :'target_account_id'::uuid
    AND c.id = :'target_conversation_id'::uuid
)
SELECT
  tc.conversation_id,
  tc.conversation_status,
  ct.id AS contact_id,
  ct.name AS contact_name,

  -- 1. PERSISTED MESSAGES & CHRONOLOGY
  (
    SELECT json_agg(json_build_object(
      'id', m.id,
      'sender_type', m.sender_type,
      'content_type', m.content_type,
      'content_text', m.content_text,
      'occurred_at', m.occurred_at,
      'created_at', m.created_at,
      'status', m.status
    ) ORDER BY m.occurred_at ASC)
    FROM public.messages m
    WHERE m.conversation_id = tc.conversation_id
  ) AS message_history,

  -- 2. ANALYSIS RUNS & PINNED CONTEXT
  (
    SELECT json_agg(json_build_object(
      'run_id', r.id,
      'status', r.status,
      'extractor_version', r.extractor_version,
      'prompt_version', r.prompt_version,
      'provider', r.provider,
      'model', r.model,
      'config_revision', r.pinned_config_revision,
      'catalog_context_hash', r.pinned_catalog_context_hash,
      'insights_count', r.insights_count,
      'latency_ms', r.latency_ms,
      'created_at', r.created_at,
      'completed_at', r.completed_at
    ) ORDER BY r.created_at DESC)
    FROM public.conversation_analysis_runs r
    WHERE r.account_id = tc.account_id AND r.conversation_id = tc.conversation_id
  ) AS analysis_runs,

  -- 3. VALIDATED INSIGHTS & EVIDENCE
  (
    SELECT json_agg(json_build_object(
      'insight_id', ci.id,
      'type', ci.insight_type,
      'value_text', ci.value_text,
      'catalog_item_id', ci.catalog_item_id,
      'confidence', ci.confidence,
      'status', ci.status,
      'observed_at', ci.observed_at,
      'evidence', (
        SELECT json_agg(json_build_object(
          'snippet', ev.snippet,
          'start_offset', ev.start_offset,
          'end_offset', ev.end_offset,
          'message_id', ev.message_id
        ))
        FROM public.conversation_insight_evidence ev
        WHERE ev.account_id = tc.account_id AND ev.insight_id = ci.id
      )
    ) ORDER BY ci.observed_at DESC)
    FROM public.conversation_insights ci
    WHERE ci.account_id = tc.account_id AND ci.conversation_id = tc.conversation_id
  ) AS insights_and_evidence,

  -- 4. CURRENT COMMERCIAL STATE
  json_build_object(
    'current_intent', p.current_intent,
    'current_intent_source', p.current_intent_source,
    'urgency', p.urgency,
    'urgency_source', p.urgency_source,
    'sentiment', p.sentiment,
    'sentiment_source', p.sentiment_source,
    'attributes', p.attributes,
    'last_update_source', p.last_update_source
  ) AS current_commercial_profile,

  -- 5. ACTIVE CATALOG INTERESTS
  (
    SELECT json_agg(json_build_object(
      'catalog_item_id', cci.catalog_item_id,
      'item_name', ci.name,
      'sku', ci.sku,
      'status', cci.status,
      'source', cci.source,
      'first_seen_at', cci.first_seen_at,
      'last_seen_at', cci.last_seen_at
    ))
    FROM public.contact_catalog_interests cci
    JOIN public.catalog_items ci ON ci.id = cci.catalog_item_id AND ci.account_id = tc.account_id
    WHERE cci.account_id = tc.account_id AND cci.contact_id = ct.id AND cci.status = 'active'
  ) AS active_catalog_interests,

  -- 6. OPEN OBJECTIONS
  (
    SELECT json_agg(json_build_object(
      'objection', co.objection,
      'normalized', co.normalized_objection,
      'status', co.status,
      'source', co.source,
      'first_seen_at', co.first_seen_at,
      'last_seen_at', co.last_seen_at
    ))
    FROM public.contact_objections co
    WHERE co.account_id = tc.account_id AND co.contact_id = ct.id AND co.status = 'open'
  ) AS open_objections,

  -- 7. CURRENT LEAD SCORE & EXPLAINABLE BREAKDOWN
  json_build_object(
    'score', s.score,
    'scoring_revision_number', s.scoring_revision_number,
    'breakdown', s.breakdown,
    'calculated_at', s.calculated_at
  ) AS current_lead_score,

  -- 8. SCORE HISTORY
  (
    SELECT json_agg(json_build_object(
      'score', h.score,
      'raw_score', h.raw_score,
      'scoring_revision_number', h.scoring_revision_number,
      'trigger_source', h.trigger_source,
      'calculated_at', h.calculated_at
    ) ORDER BY h.calculated_at DESC)
    FROM public.contact_lead_score_history h
    WHERE h.account_id = tc.account_id AND h.contact_id = ct.id
  ) AS lead_score_history

FROM target_conv tc
JOIN public.contacts ct ON ct.account_id = tc.account_id AND ct.id = tc.contact_id
LEFT JOIN public.contact_lead_profiles p ON p.account_id = tc.account_id AND p.contact_id = ct.id
LEFT JOIN public.contact_lead_scores s ON s.account_id = tc.account_id AND s.contact_id = ct.id;
