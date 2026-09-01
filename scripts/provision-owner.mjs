#!/usr/bin/env node
/**
 * ============================================================
 * Ciclopes — Verified Owner & Tenant Provisioning CLI (V1.7.2)
 * ============================================================
 *
 * Usage:
 *   node scripts/provision-owner.mjs \
 *     --account-name="Nome da Empresa" \
 *     --owner-email="owner@empresa.com" \
 *     [--owner-name="Nome do Proprietário"] \
 *     [--currency="BRL"] \
 *     [--timezone="America/Sao_Paulo"] \
 *     [--dry-run]
 *
 * Requirements:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 * ============================================================
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

function generateInviteToken() {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    accountName: "",
    ownerEmail: "",
    ownerName: "",
    currency: "BRL",
    timezone: "America/Sao_Paulo",
    dryRun: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--account-name=")) {
      options.accountName = arg.slice("--account-name=".length).trim();
    } else if (arg.startsWith("--owner-email=")) {
      options.ownerEmail = arg.slice("--owner-email=".length).trim().toLowerCase();
    } else if (arg.startsWith("--owner-name=")) {
      options.ownerName = arg.slice("--owner-name=".length).trim();
    } else if (arg.startsWith("--currency=")) {
      options.currency = arg.slice("--currency=".length).trim().toUpperCase();
    } else if (arg.startsWith("--timezone=")) {
      options.timezone = arg.slice("--timezone=".length).trim();
    }
  }

  return options;
}

function maskEmail(email) {
  if (!email || !email.includes("@")) return "***";
  const [user, domain] = email.split("@");
  const maskedUser = user.length > 2 ? `${user.slice(0, 2)}***` : `${user.slice(0, 1)}***`;
  return `${maskedUser}@${domain}`;
}

async function main() {
  const opts = parseArgs();

  if (!opts.accountName) {
    console.error("Error: --account-name is required.");
    process.exit(1);
  }
  if (!opts.ownerEmail || !opts.ownerEmail.includes("@")) {
    console.error("Error: --owner-email is required and must be a valid email address.");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment or .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("====================================================");
  console.log("CICLOPES — VERIFIED OWNER PROVISIONING");
  console.log("====================================================");
  console.log(`Account Name: ${opts.accountName}`);
  console.log(`Owner Email:  ${maskEmail(opts.ownerEmail)}`);
  console.log(`Currency:     ${opts.currency}`);
  console.log(`Timezone:     ${opts.timezone}`);
  console.log(`Mode:         ${opts.dryRun ? "DRY RUN (no changes)" : "PROVISION"}`);
  console.log("----------------------------------------------------");

  if (opts.dryRun) {
    console.log("✓ DRY RUN: Validation successful. Parameters are valid.");
    return;
  }

  // 1. Generate cryptographic token for Owner Invitation
  const { token, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // 2. Call RPC to create pending tenant and pending owner invitation
  console.log("Provisioning pending tenant workspace and owner invitation...");
  const { data: result, error: rpcErr } = await supabase.rpc("provision_new_account", {
    p_account_name: opts.accountName,
    p_owner_email: opts.ownerEmail,
    p_token_hash: hash,
    p_expires_at: expiresAt,
    p_default_currency: opts.currency,
    p_timezone: opts.timezone,
  });

  if (rpcErr) {
    console.error("RPC provision_new_account failed:", rpcErr);
    process.exit(1);
  }

  // 3. Initiate official Supabase Auth invitation if user not created
  console.log(`Sending official Auth invitation to ${maskEmail(opts.ownerEmail)}...`);
  const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(opts.ownerEmail, {
    data: { full_name: opts.ownerName || opts.accountName },
  });

  if (inviteErr) {
    console.warn(`[Notice] Supabase Auth inviteUserByEmail: ${inviteErr.message}`);
  }

  console.log("====================================================");
  console.log("PROVISIONING SUCCESSFUL (PENDING OWNER VERIFICATION)");
  console.log("====================================================");
  console.log(JSON.stringify({
    ok: true,
    account_id: result.account_id,
    account_name: result.account_name,
    owner_email: maskEmail(opts.ownerEmail),
    status: "pending_owner_verification",
    verification_required: "Official email ownership proof required before Owner access is activated"
  }, null, 2));
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
