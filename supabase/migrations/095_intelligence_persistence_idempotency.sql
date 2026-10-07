-- Preserve the factual immutability contract on duplicate observations.
-- Migration 075's upsert overwrites protected provenance/fields on conflict;
-- repeated observations can therefore fail the entire analysis transaction.
-- Change only that upsert back to metadata touch, preserving evidence append,
-- checkpoints, projection, dirty-state handling, and existing execute ACLs.
DO $patch$
DECLARE
  v_oid oid := 'public.persist_conversation_analysis_batch(uuid,uuid,uuid,text,jsonb,uuid[],uuid,timestamptz,integer,integer,integer,integer)'::regprocedure;
  v_definition text;
  v_patched text;
  v_acl aclitem[];
  v_acl_after aclitem[];
  v_pattern text := 'DO UPDATE SET\s+value_text = EXCLUDED\.value_text,\s+value_json = EXCLUDED\.value_json,\s+confidence = EXCLUDED\.confidence,\s+catalog_item_id = EXCLUDED\.catalog_item_id,\s+analysis_run_id = EXCLUDED\.analysis_run_id,\s+observed_at = EXCLUDED\.observed_at,\s+updated_at = v_now\s+RETURNING id INTO v_new_insight_id;';
BEGIN
  SELECT pg_get_functiondef(v_oid), proacl INTO v_definition, v_acl FROM pg_proc WHERE oid = v_oid;
  IF v_definition !~ v_pattern THEN
    IF v_definition ~ 'DO UPDATE SET\s+updated_at = v_now\s+RETURNING id INTO v_new_insight_id;' THEN
      RETURN; -- Already applied; safe to repeat.
    END IF;
    RAISE EXCEPTION 'Persistence patch precondition failed: unexpected function definition';
  END IF;
  v_patched := regexp_replace(v_definition, v_pattern,
    E'DO UPDATE SET updated_at = v_now\n      RETURNING id INTO v_new_insight_id;');
  EXECUTE v_patched;
  SELECT proacl INTO v_acl_after FROM pg_proc WHERE oid = v_oid;
  IF v_acl_after IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'Persistence patch unexpectedly changed execute privileges';
  END IF;
END;
$patch$;
