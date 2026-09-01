-- ============================================================
-- Migration 092: True Invite-Only Access & Auth Hardening (V1.7.0)
--
-- 1. PROFILES: Make account_id and account_role NULLABLE
--    Inert auth users (visitors signing up without invite) receive
--    an inert profile with NULL account_id and NULL account_role.
--
-- 2. HANDLE_NEW_USER: Remove automatic account/workspace self-provisioning.
--    Creating an auth.users row NEVER creates an accounts row or assigns
--    an owner role automatically.
--
-- 3. ENFORCE_PROFILE_PRIVILEGE_COLUMNS: Guard both INSERT and UPDATE
--    so authenticated/anon clients can never forge account_id or account_role.
--
-- 4. ACCOUNT_INVITATIONS: Add invited_email column with index for
--    strict email binding and ownership verification.
--
-- 5. REDEEM_INVITATION: Updated RPC with FOR UPDATE locking,
--    email-binding enforcement, inert profile upsert, and legacy
--    orphan account cleanup.
--
-- 6. PROVISION_NEW_ACCOUNT: Dedicated service_role administrative RPC
--    for creating new tenant workspaces and owners.
-- ============================================================

-- 1. NULLABLE COLUMNS ON PROFILES
ALTER TABLE public.profiles ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN account_role DROP NOT NULL;

-- 2. ADD invited_email TO ACCOUNT_INVITATIONS
ALTER TABLE public.account_invitations ADD COLUMN IF NOT EXISTS invited_email TEXT;
CREATE INDEX IF NOT EXISTS idx_account_invitations_invited_email
  ON public.account_invitations(LOWER(invited_email));

-- 3. HANDLE_NEW_USER: INERT IDENTITY PROVISIONING ONLY
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  -- Create an inert profile with NO account_id and NO account_role.
  -- Zero workspace, zero account, zero product access.
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create inert profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- 4. HARDEN PROFILES PRIVILEGE COLUMNS (INSERT + UPDATE)
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Direct PostgREST client runs as 'authenticated' or 'anon'
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.account_id IS NOT NULL OR NEW.account_role IS NOT NULL THEN
        RAISE EXCEPTION 'Privilege escalation: client cannot assign account_id or account_role on profile insert'
          USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.account_id IS DISTINCT FROM OLD.account_id
         OR NEW.account_role IS DISTINCT FROM OLD.account_role THEN
        RAISE EXCEPTION 'Privilege escalation: client cannot modify account_id or account_role on profile update'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER tr_enforce_profile_privilege_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- 5. CANONICAL REDEEM_INVITATION RPC
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
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Atomic row lock
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

  -- Fetch caller identity from auth.users
  SELECT email, COALESCE(raw_user_meta_data->>'full_name', '')
  INTO v_caller_email, v_caller_name
  FROM auth.users
  WHERE id = v_caller_id;

  -- Strict email binding check when invite specifies email
  IF v_inv.invited_email IS NOT NULL AND TRIM(v_inv.invited_email) <> '' THEN
    IF LOWER(TRIM(COALESCE(v_caller_email, ''))) <> LOWER(TRIM(v_inv.invited_email)) THEN
      RAISE EXCEPTION 'Email mismatch: this invitation was issued to %', v_inv.invited_email
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Check caller's existing profile
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

  -- Attach profile to target account with assigned role
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

  -- Stamp invitation accepted
  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up legacy orphan personal account if existed
  IF v_old_account_id IS NOT NULL THEN
    DELETE FROM accounts WHERE id = v_old_account_id;
  END IF;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- 6. SERVICE-ROLE OWNER PROVISIONING RPC
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
