import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * SERVER ONLY. Service-role client used by API route handlers after the caller's
 * session has been verified. The key is read from a non-public env var and this
 * module refuses to run in a browser.
 */
export function getAdminSupabase(): SupabaseClient | null {
  if (typeof window !== "undefined") throw new Error("adminClient must never be used in the browser");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!SUPABASE_URL || !key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
