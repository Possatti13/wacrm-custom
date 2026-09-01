-- ============================================================
-- Migration 094: Verified Owner Provisioning & True Closed Auth (V1.7.2)
--
-- 1. ACCOUNTS: Allow owner_user_id to be NULL during initial provisioning
--    until the verified Owner proves email inbox possession.
--
-- 2. ACCOUNT_INVITATIONS: Drop legacy CHECK (role <> 'owner') constraint
--    to allow server-side administrative owner invitations.
--
-- 3. REDEEM_INVITATION: Handle owner role assignment and accounts.owner_user_id
--    binding upon verified redemption.
--
-- 4. PROVISION_NEW_ACCOUNT: Refactored RPC to provision pending tenant
--    and emit a cryptographic owner invitation without fake confirmation.
-- ============================================================

-- 1. NULLABLE owner_user_id ON accounts (for pending owner verification)
ALTER TABLE public.accounts ALTER COLUMN owner_user_id DROP NOT NULL;

-- 2. DROP RESTRICTION ON OWNER INVITATIONS
ALTER TABLE public.account_invitations DROP CONSTRAINT IF EXISTS account_invitations_role_check;

-- 3. HARDENED REDEEM_INVITATION (WITH OWNER BINDING)
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
    IF v_old_account_id = v_inv.account_id THEN
      RAISE EXCEPTION 'You are already a member of this account' USING ERRCODE = '23505';
    END IF;

    SELECT owner_user_id INTO v_old_account_owner
    FROM accounts
    WHERE id = v_old_account_id;

    IF v_old_account_owner <> v_caller_id THEN
      RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
        USING ERRCODE = '23505';
    END IF;

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

  -- 7. If this is an Owner invitation, bind accounts.owner_user_id
  IF v_inv.role = 'owner' THEN
    UPDATE accounts
    SET owner_user_id = v_caller_id
    WHERE id = v_inv.account_id;
  END IF;

  -- 8. Stamp invitation accepted
  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- 9. Clean up legacy orphan personal account if existed
  IF v_old_account_id IS NOT NULL THEN
    DELETE FROM accounts WHERE id = v_old_account_id;
  END IF;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- 4. HARDENED PROVISION_NEW_ACCOUNT (PENDING OWNER INVITATION MODEL)
CREATE OR REPLACE FUNCTION public.provision_new_account(
  p_account_name TEXT,
  p_owner_email TEXT,
  p_token_hash TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_default_currency TEXT DEFAULT 'BRL',
  p_timezone TEXT DEFAULT 'America/Sao_Paulo'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true));
  v_account_id UUID;
  v_inv_id UUID;
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

  -- 1. Create tenant account in pending owner state (owner_user_id = NULL)
  INSERT INTO accounts (name, owner_user_id, default_currency, timezone)
  VALUES (
    TRIM(p_account_name),
    NULL,
    COALESCE(NULLIF(p_default_currency, ''), 'BRL'),
    COALESCE(NULLIF(p_timezone, ''), 'America/Sao_Paulo')
  )
  RETURNING id INTO v_account_id;

  -- 2. If token hash provided, create pending Owner invitation
  IF p_token_hash IS NOT NULL AND TRIM(p_token_hash) <> '' THEN
    INSERT INTO account_invitations (
      account_id,
      token_hash,
      role,
      invited_email,
      expires_at
    )
    VALUES (
      v_account_id,
      TRIM(p_token_hash),
      'owner',
      LOWER(TRIM(p_owner_email)),
      COALESCE(p_expires_at, NOW() + INTERVAL '7 days')
    )
    RETURNING id INTO v_inv_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'account_id', v_account_id,
    'account_name', TRIM(p_account_name),
    'owner_email', LOWER(TRIM(p_owner_email)),
    'status', 'pending_owner_verification',
    'invitation_id', v_inv_id
  );
END;
$$;

ALTER FUNCTION public.provision_new_account(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provision_new_account(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_new_account(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
