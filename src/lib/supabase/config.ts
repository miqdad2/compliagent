export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function missingSupabaseEnvValues(options: { requireServiceRole?: boolean } = {}) {
  const missing: string[] = [];

  if (!supabaseUrl) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!supabaseAnonKey) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (options.requireServiceRole && !supabaseServiceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  return missing;
}

export function supabaseMissingEnvMessage(options: { requireServiceRole?: boolean } = {}) {
  const missing = missingSupabaseEnvValues(options);

  if (missing.length === 0) {
    return null;
  }

  return `Missing Supabase environment value${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`;
}
