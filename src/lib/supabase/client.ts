"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./config";

export function createSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
