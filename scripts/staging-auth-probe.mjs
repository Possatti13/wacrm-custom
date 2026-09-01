import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const anonClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runStagingProbe() {
  console.log("=== STAGING AUTH CONFIG PROBE ===");
  const testEmail = `probe.ciclopes.${Date.now()}@gmail.com`;
  
  // 1. Raw Signup via public anon client
  console.log(`1. Executing public signUp for ${testEmail}...`);
  const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
    email: testEmail,
    password: "ProbePassword123!",
  });

  console.log("signUp result:", {
    error: signUpError?.message || null,
    userCreated: !!signUpData?.user,
    userId: signUpData?.user?.id,
    emailConfirmedAt: signUpData?.user?.email_confirmed_at,
    hasSession: !!signUpData?.session,
  });

  if (signUpData?.user) {
    // Check DB state
    const { data: userRow } = await adminClient
      .from("profiles")
      .select("*")
      .eq("user_id", signUpData.user.id)
      .single();

    console.log("Profile created in public.profiles:", userRow);

    // Clean up
    await adminClient.auth.admin.deleteUser(signUpData.user.id);
  }
}

runStagingProbe().catch(console.error);
