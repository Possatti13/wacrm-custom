#!/usr/bin/env node
/**
 * ============================================================
 * Ciclopes — Owner & Tenant Provisioning CLI (Security Lockdown)
 * ============================================================
 *
 * Usage:
 *   node scripts/provision-owner.mjs \
 *     --account-name="Nome da Empresa" \
 *     --owner-email="owner@empresa.com" \
 *     --owner-name="Nome do Proprietário" \
 *     --currency="BRL" \
 *     --timezone="America/Sao_Paulo" \
 *     [--dry-run]
 *
 * Requirements:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 * ============================================================
 */

import { createClient } from "@supabase/supabase-js";
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
  console.log("CICLOPES — OWNER PROVISIONING");
  console.log("====================================================");
  console.log(`Account Name: ${opts.accountName}`);
  console.log(`Owner Email:  ${maskEmail(opts.ownerEmail)}`);
  console.log(`Owner Name:   ${opts.ownerName || "(not specified)"}`);
  console.log(`Currency:     ${opts.currency}`);
  console.log(`Timezone:     ${opts.timezone}`);
  console.log(`Mode:         ${opts.dryRun ? "DRY RUN (no changes)" : "PROVISION"}`);
  console.log("----------------------------------------------------");

  if (opts.dryRun) {
    console.log("✓ DRY RUN: Validation successful. Parameters are valid.");
    return;
  }

  // 1. Check or create Auth user
  let userId = null;
  const { data: userList, error: listErr } = await supabase.auth.admin.listUsers();
  if (!listErr && userList?.users) {
    const existing = userList.users.find(
      (u) => u.email?.toLowerCase() === opts.ownerEmail.toLowerCase()
    );
    if (existing) {
      userId = existing.id;
      console.log(`✓ Existing auth user found (${userId.slice(0, 8)}...)`);
    }
  }

  if (!userId) {
    console.log(`Creating auth user for ${maskEmail(opts.ownerEmail)}...`);
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: opts.ownerEmail,
      email_confirm: true,
      user_metadata: {
        full_name: opts.ownerName || opts.accountName,
      },
    });

    if (createErr || !newUser?.user) {
      console.error("Failed to create auth user:", createErr);
      process.exit(1);
    }
    userId = newUser.user.id;
    console.log(`✓ Auth user created (${userId.slice(0, 8)}...)`);
  }

  // 2. Provision Account & Profile via RPC
  console.log("Provisioning tenant workspace and setting Owner role...");
  const { data: result, error: rpcErr } = await supabase.rpc("provision_new_account", {
    p_account_name: opts.accountName,
    p_owner_email: opts.ownerEmail,
    p_owner_full_name: opts.ownerName || null,
    p_default_currency: opts.currency,
    p_timezone: opts.timezone,
  });

  if (rpcErr) {
    console.error("RPC provision_new_account failed:", rpcErr);
    process.exit(1);
  }

  console.log("====================================================");
  console.log("PROVISIONING SUCCESSFUL");
  console.log("====================================================");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
