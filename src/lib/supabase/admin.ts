import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase admin client using the service-role key.
 *
 * Reads process.env at call time (not module load time) so that CLI worker
 * scripts can call loadLocalEnv() before this function and have the values
 * available. In the Next.js web process, env vars are always populated before
 * any module code runs, so the behaviour is identical to before.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
