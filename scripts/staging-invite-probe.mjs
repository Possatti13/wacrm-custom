import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function probeInvite() {
  console.log("=== PROBING SUPABASE ADMIN inviteUserByEmail ===");
  const testEmail = `probe.invite.${Date.now()}@gmail.com`;

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(testEmail);
  console.log("inviteUserByEmail result:", {
    error: error?.message || null,
    user: data?.user ? {
      id: data.user.id,
      email: data.user.email,
      invited_at: data.user.invited_at,
      email_confirmed_at: data.user.email_confirmed_at,
      confirmation_sent_at: data.user.confirmation_sent_at,
    } : null,
  });

  if (data?.user) {
    await adminClient.auth.admin.deleteUser(data.user.id);
    console.log("Cleaned up test invite user.");
  }
}

probeInvite().catch(console.error);
