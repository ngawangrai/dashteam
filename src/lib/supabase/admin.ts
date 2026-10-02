import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";

// Admin access to Supabase Auth, for creating and removing logins when an admin manages people.
// Uses the secret key, so it must never reach the browser. Every caller checks requireRole("admin") first.
export function createSupabaseAdminClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
