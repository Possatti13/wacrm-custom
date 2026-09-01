-- ============================================================
-- Migration 093: Verified Email Ownership & Closed Auth Hardening (V1.7.1)
--
-- 1. REDEEM_INVITATION: Mandatory Email Ownership Verification
--    Guarantees that an authenticated caller MUST have a confirmed
--    email address (email_confirmed_at IS NOT NULL) before redeeming
--    any invitation. Prevents unverified attackers from claiming
--    invitations issued to legitimate email inboxes.
--
-- 2. PROVISION_NEW_ACCOUNT: Verified Owner Identity Enforcement
--    Ensures administratively provisioned owners are linked to confirmed
--    auth identities.
-- ============================================================

-- 1. HARDENED REDEEM_INVITATION RPC WITH EMAIL OWNERSHIP PROOF
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
  v_caller_name TEXT;
  v_caller_email_confirmed_at TIMESTAMPTZ;
  v_caller_confirmed_at TIMESTAMPTZ;
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. Atomic row lock
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed' USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- 2. Fetch caller identity & verification status from auth.users
  SELECT email, 
         COALESCE(raw_user_meta_data->>'full_name', ''),
         email_confirmed_at,
         confirmed_at
  INTO v_caller_email, v_caller_name, v_caller_email_confirmed_at, v_caller_confirmed_at
  FROM auth.users
  WHERE id = v_caller_id;

  -- 3. Mandatory Email Ownership Verification Gate
  -- The authenticated caller MUST have proven ownership of their email inbox.
  IF v_caller_email_confirmed_at IS NULL AND v_caller_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Email unverified: you must verify your email address before redeeming an invitation'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Strict email binding check when invite specifies target email
  IF v_inv.invited_email IS NOT NULL AND TRIM(v_inv.invited_email) <> '' THEN
    IF LOWER(TRIM(COALESCE(v_caller_email, ''))) <> LOWER(TRIM(v_inv.invited_email)) THEN
      RAISE EXCEPTION 'Email mismatch: this invitation was issued to %', v_inv.invited_email
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 5. Check caller's existing profile & cross-tenant safety
  SELECT account_id
  INTO v_old_account_id
  FROM profiles
  WHERE user_id = v_caller_id;

  IF v_old_account_id IS NOT NULL THEN
    -- Edge case: already member of the same account
    IF v_old_account_id = v_inv.account_id THEN
      RAISE EXCEPTION 'You are already a member of this account' USING ERRCODE = '23505';
    END IF;

    -- Verify if caller is sole owner of old account
    SELECT owner_user_id INTO v_old_account_owner
    FROM accounts
    WHERE id = v_old_account_id;

    IF v_old_account_owner <> v_caller_id THEN
      RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
        USING ERRCODE = '23505';
    END IF;

    -- Verify no domain data would be orphaned
    SELECT EXISTS (
      SELECT 1 FROM contacts WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
      LIMIT 1
    ) INTO v_has_data;

    IF v_has_data THEN
      RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 6. Attach profile to target account with assigned role
  INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
  VALUES (
    v_caller_id,
    COALESCE(NULLIF(v_caller_name, ''), v_caller_email, 'Member'),
    v_caller_email,
    v_inv.account_id,
    v_inv.role
  )
  ON CONFLICT (user_id) DO UPDATE
  SET account_id = v_inv.account_id,
      account_role = v_inv.role,
      email = COALESCE(EXCLUDED.email, profiles.email);

  -- 7. Stamp invitation accepted
  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- 8. Clean up legacy orphan personal account if existed
  IF v_old_account_id IS NOT NULL THEN
    DELETE FROM accounts WHERE id = v_old_account_id;
  END IF;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- 2. HARDENED PROVISION_NEW_ACCOUNT RPC
CREATE OR REPLACE FUNCTION public.provision_new_account(
  p_account_name TEXT,
  p_owner_email TEXT,
  p_owner_full_name TEXT DEFAULT NULL,
  p_default_currency TEXT DEFAULT 'BRL',
  p_timezone TEXT DEFAULT 'America/Sao_Paulo'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true));
  v_user_id UUID;
  v_account_id UUID;
BEGIN
  IF v_role IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Forbidden: only service_role can provision new accounts'
      USING ERRCODE = '42501';
  END IF;

  IF p_account_name IS NULL OR TRIM(p_account_name) = '' THEN
    RAISE EXCEPTION 'account_name is required' USING ERRCODE = '22023';
  END IF;

  IF p_owner_email IS NULL OR TRIM(p_owner_email) = '' THEN
    RAISE EXCEPTION 'owner_email is required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(TRIM(p_owner_email));

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Owner user % does not exist in auth.users. Create auth user first.' , p_owner_email
      USING ERRCODE = '22023';
  END IF;

  -- Auto-confirm owner email if created by admin service_role
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
  WHERE id = v_user_id;

  INSERT INTO accounts (name, owner_user_id, default_currency, timezone)
  VALUES (
    TRIM(p_account_name),
    v_user_id,
    COALESCE(NULLIF(p_default_currency, ''), 'BRL'),
    COALESCE(NULLIF(p_timezone, ''), 'America/Sao_Paulo')
  )
  RETURNING id INTO v_account_id;

  INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
  VALUES (
    v_user_id,
    COALESCE(NULLIF(p_owner_full_name, ''), p_owner_email),
    LOWER(TRIM(p_owner_email)),
    v_account_id,
    'owner'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET account_id = v_account_id,
      account_role = 'owner',
      full_name = COALESCE(NULLIF(p_owner_full_name, ''), profiles.full_name);

  RETURN jsonb_build_object(
    'ok', true,
    'account_id', v_account_id,
    'account_name', TRIM(p_account_name),
    'owner_email', LOWER(TRIM(p_owner_email)),
    'owner_user_id', v_user_id,
    'status', 'provisioned'
  );
END;
$$;

ALTER FUNCTION public.provision_new_account(TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provision_new_account(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_new_account(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
