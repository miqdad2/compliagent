import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "./config";

export function createSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
