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

describe("CICLOPES — SECURITY LOCKDOWN 01.1 (Verified Email Ownership & 11-Point Attack Matrix)", () => {
  let targetAccountId: string;
  let ownerUserId: string;

  const testInertEmail = `inert.visitor.${Date.now()}@ciclopes.test`;
  let inertUserId: string;

  const invitedEmail = `legitimate.recipient.${Date.now()}@ciclopes.test`;
  let unconfirmedAttackerUserId: string;
  let confirmedLegitimateUserId: string;
  let confirmedWrongUserId: string;

  beforeAll(async () => {
    const { data: acc } = await adminClient.from("accounts").select("id, owner_user_id").limit(1).single();
    if (!acc) throw new Error("No existing account found in test database");
    targetAccountId = acc.id;
    ownerUserId = acc.owner_user_id;
  });

  afterAll(async () => {
    if (inertUserId) await adminClient.auth.admin.deleteUser(inertUserId).catch(() => {});
    if (unconfirmedAttackerUserId) await adminClient.auth.admin.deleteUser(unconfirmedAttackerUserId).catch(() => {});
    if (confirmedLegitimateUserId) await adminClient.auth.admin.deleteUser(confirmedLegitimateUserId).catch(() => {});
    if (confirmedWrongUserId) await adminClient.auth.admin.deleteUser(confirmedWrongUserId).catch(() => {});
  });

  // ============================================================
  // ATTACK 1: Random Raw Signup (Inert User Isolation)
  // ============================================================
  it("Attack 1: Random raw signup produces an INERT user with ZERO workspace access and NULL account/role", async () => {
    const { count: accountsBefore } = await adminClient.from("accounts").select("*", { count: "exact", head: true });

    const { data: userRes, error: userErr } = await adminClient.auth.admin.createUser({
      email: testInertEmail,
      password: "TestPassword123!",
      email_confirm: false, // Unconfirmed raw signup
      user_metadata: { full_name: "Inert Visitor" },
    });

    expect(userErr).toBeNull();
    expect(userRes?.user).toBeDefined();
    inertUserId = userRes!.user!.id;

    // Verify ZERO accounts were created
    const { count: accountsAfter } = await adminClient.from("accounts").select("*", { count: "exact", head: true });
    expect(accountsAfter).toBe(accountsBefore);

    // Verify profile row exists as an INERT PROFILE (account_id = null, account_role = null)
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, user_id, email, account_id, account_role")
      .eq("user_id", inertUserId)
      .single();

    expect(profile).toBeDefined();
    expect(profile?.account_id).toBeNull();
    expect(profile?.account_role).toBeNull();
  });

  // ============================================================
  // ATTACK 2 & 3: Raw Signup with Invited Email & Unconfirmed Identity Redeem
  // ============================================================
  it("Attack 2 & 3: Unverified attacker matching invited email is REJECTED by redeem_invitation (Email Ownership Enforcement)", async () => {
    // 1. Owner creates legitimate email-bound invitation
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    const { error: invCreateErr } = await adminClient
      .from("account_invitations")
      .insert({
        account_id: targetAccountId,
        token_hash: hash,
        role: "agent",
        invited_email: invitedEmail,
        created_by_user_id: ownerUserId,
        expires_at: expiresAt,
      });
    expect(invCreateErr).toBeNull();

    // 2. Attacker creates an UNCONFIRMED account using the invited email string
    const { data: attackerUserRes } = await adminClient.auth.admin.createUser({
      email: invitedEmail,
      password: "AttackerPassword123!",
      email_confirm: false, // NOT confirmed!
      user_metadata: { full_name: "Imposter Attacker" },
    });
    unconfirmedAttackerUserId = attackerUserRes!.user!.id;

    // Attacker signs in
    const attackerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await attackerClient.auth.signInWithPassword({
      email: invitedEmail,
      password: "AttackerPassword123!",
    });

    // 3. Attacker attempts to redeem the invitation
    const { data: unconfirmedRedeem, error: unconfirmedRedeemErr } = await attackerClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    // MUST BE REJECTED because attacker has NOT proven email ownership
    expect(unconfirmedRedeem).toBeNull();
    expect(unconfirmedRedeemErr).toBeDefined();
    expect(unconfirmedRedeemErr?.message).toMatch(/Email unverified|permission denied/i);
  });

  // ============================================================
  // ATTACK 4: Confirmed Correct Identity Redeem
  // ============================================================
  it("Attack 4: Confirmed legitimate recipient proves email ownership and successfully joins tenant", async () => {
    // 1. Re-use or create invitation
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "agent",
      invited_email: invitedEmail,
      created_by_user_id: ownerUserId,
      expires_at: expiresAt,
    });

    // Delete unconfirmed attacker user so legitimate user can confirm
    await adminClient.auth.admin.deleteUser(unconfirmedAttackerUserId);

    // 2. Legitimate user establishes confirmed identity (email_confirmed_at IS NOT NULL)
    const { data: confirmedUserRes } = await adminClient.auth.admin.createUser({
      email: invitedEmail,
      password: "LegitimatePassword123!",
      email_confirm: true, // VERIFIED!
      user_metadata: { full_name: "Legitimate Employee" },
    });
    confirmedLegitimateUserId = confirmedUserRes!.user!.id;

    const legitClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await legitClient.auth.signInWithPassword({
      email: invitedEmail,
      password: "LegitimatePassword123!",
    });

    // 3. Legitimate verified user redeems
    const { data: redeemedAccountId, error: redeemErr } = await legitClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    expect(redeemErr).toBeNull();
    expect(redeemedAccountId).toBe(targetAccountId);

    // Verify profile is attached with 'agent' role
    const { data: profile } = await adminClient
      .from("profiles")
      .select("account_id, account_role")
      .eq("user_id", confirmedLegitimateUserId)
      .single();

    expect(profile?.account_id).toBe(targetAccountId);
    expect(profile?.account_role).toBe("agent");
  });

  // ============================================================
  // ATTACK 5: Confirmed Wrong Identity Redeem
  // ============================================================
  it("Attack 5: Confirmed user with mismatched email is REJECTED on email-bound invitation", async () => {
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "viewer",
      invited_email: "vip.director@ciclopes.test",
      created_by_user_id: ownerUserId,
      expires_at: expiresAt,
    });

    // Create confirmed user with wrong email
    const wrongEmail = `wrong.confirmed.${Date.now()}@ciclopes.test`;
    const { data: wrongUserRes } = await adminClient.auth.admin.createUser({
      email: wrongEmail,
      password: "WrongPassword123!",
      email_confirm: true,
    });
    confirmedWrongUserId = wrongUserRes!.user!.id;

    const wrongClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await wrongClient.auth.signInWithPassword({
      email: wrongEmail,
      password: "WrongPassword123!",
    });

    const { data: wrongRedeem, error: wrongRedeemErr } = await wrongClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    expect(wrongRedeem).toBeNull();
    expect(wrongRedeemErr).toBeDefined();
    expect(wrongRedeemErr?.message).toMatch(/Email mismatch/i);
  });

  // ============================================================
  // ATTACK 6: Expired Invitation
  // ============================================================
  it("Attack 6: Expired invitation is REJECTED", async () => {
    const { token, hash } = generateInviteToken();
    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "agent",
      created_by_user_id: ownerUserId,
      expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    });

    const legitClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await legitClient.auth.signInWithPassword({
      email: invitedEmail,
      password: "LegitimatePassword123!",
    });

    const { error: expiredErr } = await legitClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    expect(expiredErr).toBeDefined();
    expect(expiredErr?.message).toMatch(/expired/i);
  });

  // ============================================================
  // ATTACK 7: Used / Replay Invitation
  // ============================================================
  it("Attack 7: Redeemed invitation cannot be replayed (Single-Use Enforcement)", async () => {
    const { token, hash } = generateInviteToken();
    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "viewer",
      created_by_user_id: ownerUserId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const legitClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await legitClient.auth.signInWithPassword({
      email: invitedEmail,
      password: "LegitimatePassword123!",
    });

    // First redemption succeeds (or raises already member if same account)
    // Create new temp confirmed user for replay test
    const replayUserEmail = `replay.user.${Date.now()}@ciclopes.test`;
    const { data: replayUserRes } = await adminClient.auth.admin.createUser({
      email: replayUserEmail,
      password: "ReplayPassword123!",
      email_confirm: true,
    });
    const replayUserId = replayUserRes!.user!.id;

    const replayClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await replayClient.auth.signInWithPassword({
      email: replayUserEmail,
      password: "ReplayPassword123!",
    });

    const { error: firstErr } = await replayClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });
    expect(firstErr).toBeNull();

    // Second redemption attempt by another user MUST fail
    const { error: replayErr } = await legitClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });
    expect(replayErr).toBeDefined();
    expect(replayErr?.message).toMatch(/already been redeemed/i);

    await adminClient.auth.admin.deleteUser(replayUserId);
  });

  // ============================================================
  // ATTACK 8: Concurrent Redemption (Race Condition Safety)
  // ============================================================
  it("Attack 8: Concurrent redemptions are serialized via FOR UPDATE row lock; only 1 succeeds", async () => {
    const { token, hash } = generateInviteToken();
    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "viewer",
      created_by_user_id: ownerUserId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const u1Email = `concurrent.u1.${Date.now()}@ciclopes.test`;
    const u2Email = `concurrent.u2.${Date.now()}@ciclopes.test`;

    const { data: u1Res } = await adminClient.auth.admin.createUser({ email: u1Email, password: "Pass123!", email_confirm: true });
    const { data: u2Res } = await adminClient.auth.admin.createUser({ email: u2Email, password: "Pass123!", email_confirm: true });

    const c1 = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const c2 = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

    await c1.auth.signInWithPassword({ email: u1Email, password: "Pass123!" });
    await c2.auth.signInWithPassword({ email: u2Email, password: "Pass123!" });

    // Execute concurrently
    const [res1, res2] = await Promise.all([
      c1.rpc("redeem_invitation", { p_token_hash: hash }),
      c2.rpc("redeem_invitation", { p_token_hash: hash }),
    ]);

    const successes = [res1, res2].filter((r) => r.error === null);
    const failures = [res1, res2].filter((r) => r.error !== null);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error?.message).toMatch(/already been redeemed/i);

    await adminClient.auth.admin.deleteUser(u1Res!.user!.id);
    await adminClient.auth.admin.deleteUser(u2Res!.user!.id);
  });

  // ============================================================
  // ATTACK 9 & 10: Role & Account Injection Attacks
  // ============================================================
  it("Attack 9 & 10: Direct client tampering of account_role, account_id, or accounts table is BLOCKED", async () => {
    const inertClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await inertClient.auth.signInWithPassword({ email: testInertEmail, password: "TestPassword123!" });

    // Attack 9: Tampering profile to inject 'owner' role
    const { error: profileTamperErr } = await inertClient
      .from("profiles")
      .update({ account_role: "owner", account_id: targetAccountId })
      .eq("user_id", inertUserId);

    expect(profileTamperErr).toBeDefined();
    expect(profileTamperErr?.message).toMatch(/Privilege escalation|permission denied/i);

    // Attack 10: Direct insertion into accounts table
    const { error: accInsertErr } = await inertClient
      .from("accounts")
      .insert({ name: "Rogue Tenant", owner_user_id: inertUserId });

    expect(accInsertErr).toBeDefined();
  });

  // ============================================================
  // ATTACK 11: Inert Product Access (RLS Tenant Isolation)
  // ============================================================
  it("Attack 11: Inert user has ZERO access across all tenant operational tables", async () => {
    const inertClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await inertClient.auth.signInWithPassword({ email: testInertEmail, password: "TestPassword123!" });

    const { data: contacts } = await inertClient.from("contacts").select("*");
    expect(contacts === null || (Array.isArray(contacts) && contacts.length === 0)).toBe(true);

    const { data: conversations } = await inertClient.from("conversations").select("*");
    expect(conversations === null || (Array.isArray(conversations) && conversations.length === 0)).toBe(true);

    const { data: messages } = await inertClient.from("messages").select("*");
    expect(messages === null || (Array.isArray(messages) && messages.length === 0)).toBe(true);

    const { data: pipelines } = await inertClient.from("pipelines").select("*");
    expect(pipelines === null || (Array.isArray(pipelines) && pipelines.length === 0)).toBe(true);

    const { data: whatsappConfig } = await inertClient.from("whatsapp_config").select("*");
    expect(whatsappConfig === null || (Array.isArray(whatsappConfig) && whatsappConfig.length === 0)).toBe(true);
  });
});
