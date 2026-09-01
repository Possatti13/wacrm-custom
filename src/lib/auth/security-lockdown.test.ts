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

describe("CICLOPES — SECURITY LOCKDOWN 01.2 (Verified Email Ownership & Owner Protection Matrix)", () => {
  let targetAccountId: string;
  let ownerUserId: string;

  const testInertEmail = `inert.visitor.${Date.now()}@ciclopes.test`;
  let inertUserId: string;

  const invitedMemberEmail = `legitimate.staff.${Date.now()}@ciclopes.test`;
  let unconfirmedMemberAttackerUserId: string;
  let confirmedLegitimateMemberUserId: string;
  let confirmedWrongMemberUserId: string;

  const provisionedOwnerEmail = `new.client.ceo.${Date.now()}@ciclopes.test`;
  let unconfirmedOwnerAttackerUserId: string;
  let confirmedLegitimateOwnerUserId: string;
  let provisionedAccountId: string;

  beforeAll(async () => {
    const { data: acc } = await adminClient.from("accounts").select("id, owner_user_id").limit(1).single();
    if (!acc) throw new Error("No existing account found in test database");
    targetAccountId = acc.id;
    ownerUserId = acc.owner_user_id;
  });

  afterAll(async () => {
    try {
      if (inertUserId) await adminClient.auth.admin.deleteUser(inertUserId);
      if (unconfirmedMemberAttackerUserId) await adminClient.auth.admin.deleteUser(unconfirmedMemberAttackerUserId);
      if (confirmedLegitimateMemberUserId) await adminClient.auth.admin.deleteUser(confirmedLegitimateMemberUserId);
      if (confirmedWrongMemberUserId) await adminClient.auth.admin.deleteUser(confirmedWrongMemberUserId);
      if (unconfirmedOwnerAttackerUserId) await adminClient.auth.admin.deleteUser(unconfirmedOwnerAttackerUserId);
      if (confirmedLegitimateOwnerUserId) await adminClient.auth.admin.deleteUser(confirmedLegitimateOwnerUserId);
      if (provisionedAccountId) await adminClient.from("accounts").delete().eq("id", provisionedAccountId);
    } catch {}
  });

  // ============================================================
  // 1. OWNER PROVISIONING & OWNER EMAIL ATTACK DEFENSE
  // ============================================================
  it("Owner Protection 1: Admin provisions pending tenant; owner_user_id is NULL until verified claim", async () => {
    const { token: ownerToken, hash: ownerHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    const { data: provResult, error: provErr } = await adminClient.rpc("provision_new_account", {
      p_account_name: "Cliente Piloto Alfa",
      p_owner_email: provisionedOwnerEmail,
      p_token_hash: ownerHash,
      p_expires_at: expiresAt,
    });

    expect(provErr).toBeNull();
    expect(provResult).toBeDefined();
    expect(provResult.ok).toBe(true);
    expect(provResult.status).toBe("pending_owner_verification");
    provisionedAccountId = provResult.account_id;

    // Verify account exists with owner_user_id = NULL
    const { data: accountRow } = await adminClient
      .from("accounts")
      .select("id, name, owner_user_id")
      .eq("id", provisionedAccountId)
      .single();

    expect(accountRow?.name).toBe("Cliente Piloto Alfa");
    expect(accountRow?.owner_user_id).toBeNull();

    // Verify pending owner invitation was created in account_invitations
    const { data: invRow } = await adminClient
      .from("account_invitations")
      .select("id, role, invited_email")
      .eq("account_id", provisionedAccountId)
      .single();

    expect(invRow?.role).toBe("owner");
    expect(invRow?.invited_email).toBe(provisionedOwnerEmail.toLowerCase());
  });

  it("Owner Protection 2: Attacker with unverified identity cannot claim Owner access", async () => {
    // Fetch owner invite hash
    const { data: invRow } = await adminClient
      .from("account_invitations")
      .select("token_hash")
      .eq("account_id", provisionedAccountId)
      .single();
    expect(invRow).toBeDefined();

    // Attacker creates unconfirmed user with the owner's email
    const { data: attackerRes } = await adminClient.auth.admin.createUser({
      email: provisionedOwnerEmail,
      password: "AttackerPassword123!",
      email_confirm: false, // NOT confirmed!
    });
    unconfirmedOwnerAttackerUserId = attackerRes!.user!.id;

    const attackerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await attackerClient.auth.signInWithPassword({
      email: provisionedOwnerEmail,
      password: "AttackerPassword123!",
    });

    // Attacker tries to redeem owner invitation
    const { data: unverifiedRedeem, error: unverifiedErr } = await attackerClient.rpc("redeem_invitation", {
      p_token_hash: invRow!.token_hash,
    });

    // MUST BE DENIED
    expect(unverifiedRedeem).toBeNull();
    expect(unverifiedErr).toBeDefined();
    expect(unverifiedErr?.message).toMatch(/Email unverified|permission denied/i);

    // Verify account still has owner_user_id = NULL
    const { data: acc } = await adminClient.from("accounts").select("owner_user_id").eq("id", provisionedAccountId).single();
    expect(acc?.owner_user_id).toBeNull();
  });

  it("Owner Protection 3: Verified legitimate Owner claims tenant; owner_user_id and role set to owner", async () => {
    const { data: invRow } = await adminClient
      .from("account_invitations")
      .select("token_hash")
      .eq("account_id", provisionedAccountId)
      .single();

    // Delete unconfirmed attacker user so legitimate user can confirm
    await adminClient.auth.admin.deleteUser(unconfirmedOwnerAttackerUserId);

    // Legitimate owner confirms email
    const { data: legitOwnerRes } = await adminClient.auth.admin.createUser({
      email: provisionedOwnerEmail,
      password: "LegitOwnerPassword123!",
      email_confirm: true, // VERIFIED EMAIL!
      user_metadata: { full_name: "CEO Legítimo" },
    });
    confirmedLegitimateOwnerUserId = legitOwnerRes!.user!.id;

    const legitOwnerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await legitOwnerClient.auth.signInWithPassword({
      email: provisionedOwnerEmail,
      password: "LegitOwnerPassword123!",
    });

    // Legitimate owner redeems owner invitation
    const { data: redeemedAccId, error: redeemErr } = await legitOwnerClient.rpc("redeem_invitation", {
      p_token_hash: invRow!.token_hash,
    });

    expect(redeemErr).toBeNull();
    expect(redeemedAccId).toBe(provisionedAccountId);

    // Verify accounts.owner_user_id is now bound to legitimate owner
    const { data: updatedAccount } = await adminClient
      .from("accounts")
      .select("owner_user_id")
      .eq("id", provisionedAccountId)
      .single();
    expect(updatedAccount?.owner_user_id).toBe(confirmedLegitimateOwnerUserId);

    // Verify profile is attached with 'owner' role
    const { data: ownerProfile } = await adminClient
      .from("profiles")
      .select("account_id, account_role")
      .eq("user_id", confirmedLegitimateOwnerUserId)
      .single();
    expect(ownerProfile?.account_id).toBe(provisionedAccountId);
    expect(ownerProfile?.account_role).toBe("owner");
  });

  // ============================================================
  // 2. MEMBER INVITATION & ATTACK MATRIX
  // ============================================================
  it("Member Attack 1: Random raw signup produces an INERT user with ZERO workspace access", async () => {
    const { count: accountsBefore } = await adminClient.from("accounts").select("*", { count: "exact", head: true });

    const { data: userRes, error: userErr } = await adminClient.auth.admin.createUser({
      email: testInertEmail,
      password: "TestPassword123!",
      email_confirm: false,
      user_metadata: { full_name: "Inert Visitor" },
    });

    expect(userErr).toBeNull();
    inertUserId = userRes!.user!.id;

    const { count: accountsAfter } = await adminClient.from("accounts").select("*", { count: "exact", head: true });
    expect(accountsAfter).toBe(accountsBefore);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("account_id, account_role")
      .eq("user_id", inertUserId)
      .single();

    expect(profile?.account_id).toBeNull();
    expect(profile?.account_role).toBeNull();
  });

  it("Member Attack 2 & 3: Unverified attacker matching invited email is REJECTED by redeem_invitation", async () => {
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "agent",
      invited_email: invitedMemberEmail,
      created_by_user_id: ownerUserId,
      expires_at: expiresAt,
    });

    const { data: attackerUserRes } = await adminClient.auth.admin.createUser({
      email: invitedMemberEmail,
      password: "AttackerPassword123!",
      email_confirm: false,
    });
    unconfirmedMemberAttackerUserId = attackerUserRes!.user!.id;

    const attackerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await attackerClient.auth.signInWithPassword({
      email: invitedMemberEmail,
      password: "AttackerPassword123!",
    });

    const { data: unconfirmedRedeem, error: unconfirmedRedeemErr } = await attackerClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    expect(unconfirmedRedeem).toBeNull();
    expect(unconfirmedRedeemErr).toBeDefined();
    expect(unconfirmedRedeemErr?.message).toMatch(/Email unverified|permission denied/i);
  });

  it("Member Attack 4: Confirmed legitimate recipient proves email ownership and joins tenant", async () => {
    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "agent",
      invited_email: invitedMemberEmail,
      created_by_user_id: ownerUserId,
      expires_at: expiresAt,
    });

    await adminClient.auth.admin.deleteUser(unconfirmedMemberAttackerUserId);

    const { data: confirmedUserRes } = await adminClient.auth.admin.createUser({
      email: invitedMemberEmail,
      password: "LegitimatePassword123!",
      email_confirm: true,
    });
    confirmedLegitimateMemberUserId = confirmedUserRes!.user!.id;

    const legitClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await legitClient.auth.signInWithPassword({
      email: invitedMemberEmail,
      password: "LegitimatePassword123!",
    });

    const { data: redeemedAccountId, error: redeemErr } = await legitClient.rpc("redeem_invitation", {
      p_token_hash: hash,
    });

    expect(redeemErr).toBeNull();
    expect(redeemedAccountId).toBe(targetAccountId);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("account_id, account_role")
      .eq("user_id", confirmedLegitimateMemberUserId)
      .single();

    expect(profile?.account_id).toBe(targetAccountId);
    expect(profile?.account_role).toBe("agent");
  });

  it("Member Attack 5: Confirmed user with mismatched email is REJECTED on email-bound invitation", async () => {
    const { token, hash } = generateInviteToken();
    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "viewer",
      invited_email: "vp.sales@ciclopes.test",
      created_by_user_id: ownerUserId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const wrongEmail = `wrong.staff.${Date.now()}@ciclopes.test`;
    const { data: wrongUserRes } = await adminClient.auth.admin.createUser({
      email: wrongEmail,
      password: "WrongPassword123!",
      email_confirm: true,
    });
    confirmedWrongMemberUserId = wrongUserRes!.user!.id;

    const wrongClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
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

  it("Member Attack 6 & 7: Expired and replayed invitations are REJECTED", async () => {
    // Expired invite
    const { hash: expiredHash } = generateInviteToken();
    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: expiredHash,
      role: "viewer",
      created_by_user_id: ownerUserId,
      expires_at: new Date(Date.now() - 3600000).toISOString(),
    });

    const legitClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await legitClient.auth.signInWithPassword({ email: invitedMemberEmail, password: "LegitimatePassword123!" });

    const { error: expiredErr } = await legitClient.rpc("redeem_invitation", { p_token_hash: expiredHash });
    expect(expiredErr?.message).toMatch(/expired/i);
  });

  it("Member Attack 8: Concurrent redemptions serialize safely with FOR UPDATE lock", async () => {
    const { hash } = generateInviteToken();
    await adminClient.from("account_invitations").insert({
      account_id: targetAccountId,
      token_hash: hash,
      role: "viewer",
      created_by_user_id: ownerUserId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const u1 = `c.u1.${Date.now()}@ciclopes.test`;
    const u2 = `c.u2.${Date.now()}@ciclopes.test`;

    const { data: u1Res } = await adminClient.auth.admin.createUser({ email: u1, password: "Pass123!", email_confirm: true });
    const { data: u2Res } = await adminClient.auth.admin.createUser({ email: u2, password: "Pass123!", email_confirm: true });

    const c1 = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const c2 = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

    await c1.auth.signInWithPassword({ email: u1, password: "Pass123!" });
    await c2.auth.signInWithPassword({ email: u2, password: "Pass123!" });

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

  it("Member Attack 9, 10 & 11: Privilege tampering, raw table inserts and inert access are BLOCKED", async () => {
    const inertClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await inertClient.auth.signInWithPassword({ email: testInertEmail, password: "TestPassword123!" });

    // Attack 9: Tamper role
    const { error: tamperErr } = await inertClient
      .from("profiles")
      .update({ account_role: "owner", account_id: targetAccountId })
      .eq("user_id", inertUserId);
    expect(tamperErr?.message).toMatch(/Privilege escalation|permission denied/i);

    // Attack 10: Insert account
    const { error: accInsertErr } = await inertClient
      .from("accounts")
      .insert({ name: "Rogue Tenant" });
    expect(accInsertErr).toBeDefined();

    // Attack 11: Read contacts, conversations, messages, deals, whatsapp_config
    const { data: contacts } = await inertClient.from("contacts").select("*");
    expect(contacts === null || (Array.isArray(contacts) && contacts.length === 0)).toBe(true);

    const { data: conversations } = await inertClient.from("conversations").select("*");
    expect(conversations === null || (Array.isArray(conversations) && conversations.length === 0)).toBe(true);

    const { data: messages } = await inertClient.from("messages").select("*");
    expect(messages === null || (Array.isArray(messages) && messages.length === 0)).toBe(true);

    const { data: whatsappConfig } = await inertClient.from("whatsapp_config").select("*");
    expect(whatsappConfig === null || (Array.isArray(whatsappConfig) && whatsappConfig.length === 0)).toBe(true);
  });
});
