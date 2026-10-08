-- Close every known supersede RPC entry point without changing its commercial body.
-- SECURITY DEFINER current_user identifies the owner, never the invoking caller.
-- Keep both signatures: the 11-argument RPC is used by the repository; absence
-- of external callers of the 10-argument overload has not been established.
DO $security_closure$
DECLARE
  v_signature text;
  v_oid oid;
  v_before record;
  v_after record;
  v_definition text;
  v_patched text;
  v_legacy_gate text := 'IF current_user NOT IN \(''service_role'', ''postgres''\)\s+AND COALESCE\(pg_catalog\.current_setting\(''request\.jwt\.claim\.role'', true\), ''''\) <> ''service_role'' THEN';
  v_worker_gate text := E'IF auth.role() IS DISTINCT FROM ''service_role''\n       OR pg_catalog.current_setting(''role'', true) IS DISTINCT FROM ''service_role'' THEN';
BEGIN
  -- Fail closed on schema drift, including any third overload not audited here.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'supersede_conversation_insight') <> 2 THEN
    RAISE EXCEPTION 'Unexpected supersede_conversation_insight overload inventory';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.supersede_conversation_insight(uuid,uuid,uuid,text,text,jsonb,uuid,numeric,text,jsonb)',
    'public.supersede_conversation_insight(uuid,uuid,uuid,text,text,jsonb,uuid,numeric,text,text,jsonb)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing expected insight RPC: %', v_signature;
    END IF;
    SELECT p.proowner, p.prosecdef, p.proconfig, p.prolang INTO v_before
      FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF pg_catalog.pg_get_userbyid(v_before.proowner) <> 'postgres'
       OR NOT v_before.prosecdef
       OR v_before.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR v_before.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql') THEN
      RAISE EXCEPTION 'Unexpected owner/security/search_path/language: %', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF v_definition ~ v_legacy_gate THEN
      IF (SELECT count(*) FROM pg_catalog.regexp_matches(v_definition, v_legacy_gate, 'g')) <> 1 THEN
        RAISE EXCEPTION 'Ambiguous authorization gate: %', v_signature;
      END IF;
      v_patched := pg_catalog.regexp_replace(v_definition, v_legacy_gate, v_worker_gate);
      EXECUTE v_patched;
    ELSIF pg_catalog.strpos(v_definition, v_worker_gate) = 0 THEN
      RAISE EXCEPTION 'Unknown authorization gate: %', v_signature;
    END IF;

    -- JWT role and actual invoking SQL role must both be service_role for a
    -- worker without auth.uid(). Members retain the existing agent+ tenant check.
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_signature);

    SELECT p.proowner, p.prosecdef, p.proconfig, p.prolang INTO v_after
      FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_after IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'Insight RPC metadata changed unexpectedly: %', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p,
           LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
         WHERE p.oid = v_oid AND a.privilege_type = 'EXECUTE'
           AND a.grantee NOT IN (v_before.proowner,
             (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'),
             (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'))
       ) THEN
      RAISE EXCEPTION 'Unexpected final insight RPC EXECUTE ACL: %', v_signature;
    END IF;
  END LOOP;
END;
$security_closure$;
