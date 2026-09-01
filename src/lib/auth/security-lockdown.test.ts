import { describe, it, expect, beforeAll, afterAll } from "vitest";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { generateInviteToken, hashInviteToken } from "./invitations";

dotenv.config({ path: ".env.local", override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("CICLOPES — SECURITY LOCKDOWN 01 (True Invite-Only & Auth Hardening)", () => {
  let targetAccountId: string;
  let ownerUserId: string;

  const testInertEmail = `inert.visitor.${Date.now()}@ciclopes.test`;
  let inertUserId: string;

  const invitedEmail = `invited.staff.${Date.now()}@ciclopes.test`;
  let invitedUserId: string;

  const attackerEmail = `attacker.imposter.${Date.now()}@ciclopes.test`;
  let attackerUserId: string;

  beforeAll(async () => {
    // 1. Fetch an existing target account
    const { data: acc } = await adminClient.from("accounts").select("id, owner_user_id").limit(1).single();
    if (!acc) throw new Error("No existing account found in test database");
    targetAccountId = acc.id;
    ownerUserId = acc.owner_user_id;
  });

  afterAll(async () => {
    // Clean up test auth users created during test
    if (inertUserId) await adminClient.auth.admin.deleteUser(inertUserId);
    if (invitedUserId) await adminClient.auth.admin.deleteUser(invitedUserId);
    if (attackerUserId) await adminClient.auth.admin.deleteUser(attackerUserId);
  });

  // ============================================================
  // 1. RAW PUBLIC SIGNUP -> INERT USER ISOLATION
  // ============================================================
  it("A. Raw Supabase Auth signup produces an INERT user with ZERO workspace access and NULL account/role", async () => {
    // Count accounts before signup
    const { count: accountsBefore } = await adminClient.from("accounts").select("*", { count: "exact", head: true });

    // Simulate raw uninvited signup in auth.users
    const { data: userRes, error: userErr } = await adminClient.auth.admin.createUser({
      email: testInertEmail,
      password: "TestPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Inert Visitor" },
    });

    expect(userErr).toBeNull();
    expect(userRes?.user).toBeDefined();
    inertUserId = userRes!.user!.id;

    // Verify ZERO accounts were created
    const { count: accountsAfter } = await adminClient.from("accounts").select("*", { count: "exact", head: true });
    expect(accountsAfter).toBe(accountsBefore);

    // Verify profile was created with NULL account_id and NULL account_role
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, user_id, email, account_id, account_role")
      .eq("user_id", inertUserId)
      .single();

    expect(profile).toBeDefined();
    expect(profile?.account_id).toBeNull();
    expect(profile?.account_role).toBeNull();

    // Verify RLS isolation: login as inert user with anon client
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: loginSession, error: loginErr } = await userClient.auth.signInWithPassword({
      email: testInertEmail,
      password: "TestPassword123!",
    });
    expect(loginErr).toBeNull();
    expect(loginSession?.session).toBeDefined();

    // Inert user client cannot read any contacts, conversations or messages
    const { data: contacts } = await userClient.from("contacts").select("*");
    expect(contacts).toEqual([]);

    const { data: conversations } = await userClient.from("conversations").select("*");
    expect(conversations).toEqual([]);

    const { data: messages } = await userClient.from("messages").select("*");
    expect(messages).toEqual([]);
  });

  // ============================================================
  // 2. DIRECT CLIENT PRIVILEGE ESCALATION ATTACKS (REST / RLS)
  // ============================================================
  it("B. Direct client cannot insert or update privilege columns (account_id, account_role) on profiles", async () => {
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await userClient.auth.signInWithPassword({
      email: testInertEmail,
      password: "TestPassword123!",
    });

    // Attack 1: Direct UPDATE attempting to elevate to owner
    const { error: updateErr } = await userClient
      .from("profiles")
      .update({ account_role: "owner", account_id: targetAccountId })
      .eq("user_id", inertUserId);

    expect(updateErr).toBeDefined();
    expect(updateErr?.message).toContain("Privilege escalation");

    // Attack 2: Direct INSERT into accounts table
    const { error: accInsertErr } = await userClient
      .from("accounts")
      .insert({ name: "Hacked Account", owner_user_id: inertUserId });

    expect(accInsertErr).toBeDefined();

    // Attack 3: Direct INSERT into account_invitations
    const { token, hash } = generateInviteToken();
    const { error: invInsertErr } = await userClient
      .from("account_invitations")
      .insert({
        account_id: targetAccountId,
        token_hash: hash,
        role: "admin",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });

    expect(invInsertErr).toBeDefined();
  });

  // ============================================================
  // 3. INVITATION SECURITY & ATTACK MATRIX
  // ============================================================
  it("C. Validates invitation redemption: enforces email-binding, single-use, expiry, and prevents impersonation", async () => {
    // 1. Create a legitimate email-bound invitation
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    const { data: inviteRow, error: invCreateErr } = await adminClient
      .from("account_invitations")
      .insert({
        account_id: targetAccountId,
        token_hash: hash,
        role: "agent",
        invited_email: invitedEmail,
        created_by_user_id: ownerUserId,
        expires_at: expiresAt,
      })
      .select("id, token_hash")
      .single();

    expect(invCreateErr).toBeNull();
    expect(inviteRow).toBeDefined();

    // 2. Create attacker user
    const { data: attackerRes } = await adminClient.auth.admin.createUser({
      email: attackerEmail,
      password: "AttackerPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Attacker Imposter" },
    });
    attackerUserId = attackerRes!.user!.id;

    // Attacker signs in and attempts to redeem the invite issued to invitedEmail
    const attackerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await attackerClient.auth.signInWithPassword({
      email: attackerEmail,
      password: "AttackerPassword123!",
    });

    const { data: attackerRedeem, error: attackerRedeemErr } = await attackerClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    // Attacker MUST be rejected due to Email Mismatch
    expect(attackerRedeem).toBeNull();
    expect(attackerRedeemErr).toBeDefined();
    expect(attackerRedeemErr?.message).toContain("Email mismatch");

    // 3. Create legitimate invited user
    const { data: invitedRes } = await adminClient.auth.admin.createUser({
      email: invitedEmail,
      password: "InvitedPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Invited Agent" },
    });
    invitedUserId = invitedRes!.user!.id;

    const invitedClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await invitedClient.auth.signInWithPassword({
      email: invitedEmail,
      password: "InvitedPassword123!",
    });

    // 4. Legitimate invited user redeems
    const { data: redeemedAccountId, error: redeemErr } = await invitedClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    expect(redeemErr).toBeNull();
    expect(redeemedAccountId).toBe(targetAccountId);

    // Verify profile is now linked to target account with 'agent' role
    const { data: updatedProfile } = await adminClient
      .from("profiles")
      .select("account_id, account_role")
      .eq("user_id", invitedUserId)
      .single();

    expect(updatedProfile?.account_id).toBe(targetAccountId);
    expect(updatedProfile?.account_role).toBe("agent");

    // 5. Replay Attack: second attempt to redeem same token MUST be rejected
    const { error: replayErr } = await invitedClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });
    expect(replayErr).toBeDefined();
    expect(replayErr?.message).toContain("already been redeemed");

    // 6. Expired Token Attack
    const { token: expiredToken, hash: expiredHash } = generateInviteToken();
    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: expiredHash,
      role: "viewer",
      created_by_user_id: ownerUserId,
      expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour in the past
    });

    const { error: expiredErr } = await invitedClient.rpc("redeem_invitation", {
      p_token_hash: expiredHash,
    });
    expect(expiredErr).toBeDefined();
    expect(expiredErr?.message).toContain("expired");

    // 7. Nonexistent Token Attack
    const { hash: fakeHash } = generateInviteToken();
    const { error: notFoundErr } = await invitedClient.rpc("redeem_invitation", {
      p_token_hash: fakeHash,
    });
    expect(notFoundErr).toBeDefined();
    expect(notFoundErr?.message).toContain("not found");
  });

  // ============================================================
  // 4. OWNER PROVISIONING RPC SECURITY
  // ============================================================
  it("D. provision_new_account RPC is strictly restricted to service_role and creates operational owner accounts", async () => {
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await userClient.auth.signInWithPassword({
      email: testInertEmail,
      password: "TestPassword123!",
    });

    // 1. Authenticated user attempt MUST be rejected
    const { data: userAttempt, error: userAttemptErr } = await userClient.rpc("provision_new_account", {
      p_account_name: "Illegal Account",
      p_owner_email: testInertEmail,
    });
    expect(userAttempt).toBeNull();
    expect(userAttemptErr).toBeDefined();
    expect(userAttemptErr?.message).toMatch(/permission denied|Forbidden/i);

    // 2. Service role execution succeeds
    const newTenantEmail = `new.tenant.owner.${Date.now()}@ciclopes.test`;
    const { data: ownerUserRes } = await adminClient.auth.admin.createUser({
      email: newTenantEmail,
      password: "NewOwnerPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Diretor Comercial" },
    });
    const newOwnerUserId = ownerUserRes!.user!.id;

    const { data: provisionResult, error: provisionErr } = await adminClient.rpc("provision_new_account", {
      p_account_name: "Empresa Piloto Beta",
      p_owner_email: newTenantEmail,
      p_owner_full_name: "Diretor Comercial",
      p_default_currency: "BRL",
      p_timezone: "America/Sao_Paulo",
    });

    expect(provisionErr).toBeNull();
    expect(provisionResult).toBeDefined();
    expect(provisionResult.ok).toBe(true);
    expect(provisionResult.account_name).toBe("Empresa Piloto Beta");
    expect(provisionResult.account_id).toBeDefined();

    // Verify owner profile was assigned 'owner' role and linked to new account
    const { data: ownerProfile } = await adminClient
      .from("profiles")
      .select("account_id, account_role")
      .eq("user_id", newOwnerUserId)
      .single();

    expect(ownerProfile?.account_id).toBe(provisionResult.account_id);
    expect(ownerProfile?.account_role).toBe("owner");

    // Clean up the created provisioned account and user
    await adminClient.from("accounts").delete().eq("id", provisionResult.account_id);
    await adminClient.auth.admin.deleteUser(newOwnerUserId);
  });
});
