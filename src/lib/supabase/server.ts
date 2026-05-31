import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getStaticAuthSession } from "@/lib/auth/static-auth";
import { createSupabaseAdminClient } from "./admin";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./config";

export async function createSupabaseServerClient() {
  const staticSession = await getStaticAuthSession();
  if (staticSession) {
    return createSupabaseAdminClient();
  }

  if (!isSupabaseConfigured()) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Server Components cannot always write cookies. Middleware refreshes sessions.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Server Components cannot always write cookies. Middleware refreshes sessions.
        }
      }
    }
  });
}
