/**
 * Server-only factory that wraps a Supabase admin client in the DiagnosticsClient interface.
 *
 * This file must only be imported from server-side code (API routes, Server Components).
 * It never returns credential values — only boolean presence flags and structured results.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DiagnosticsClient, StorageBucketMeta } from "./readiness";

export function buildDiagnosticsClient(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>
): DiagnosticsClient {
  return {
    async countTable(tableName: string): Promise<number | null> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count, error } = await (admin as any)
        .from(tableName)
        .select("id", { count: "exact", head: true });
      if (error) return null;
      return count ?? 0;
    },

    async getBucketMeta(bucketName: string): Promise<StorageBucketMeta | null> {
      const { data, error } = await admin.storage.getBucket(bucketName);
      if (error || !data) return null;
      return { id: data.id, public: data.public };
    },

    async countQueuedJobs(): Promise<number> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count, error } = await (admin as any)
        .from("processing_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "claimed"]);
      if (error) return 0;
      return count ?? 0;
    },

    async canReadAnnotationOutputs(): Promise<boolean> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from("annotation_outputs")
        .select("id", { count: "exact", head: true });
      return !error;
    },

    async checkRequiredRpcs(rpcNames: string[]): Promise<{ exists: boolean; missing: string[] }> {
      const missing: string[] = [];
      for (const fn of rpcNames) {
        // Probe by calling with empty args. If the function doesn't exist, PostgREST
        // returns PGRST202 / "Could not find the function". Any other error means
        // the function exists but rejected invalid arguments — that's fine.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (admin as any).rpc(fn, {});
        if (
          error &&
          (error.code === "PGRST202" ||
            (typeof error.message === "string" &&
              error.message.toLowerCase().includes("could not find the function")))
        ) {
          missing.push(fn);
        }
      }
      return { exists: missing.length === 0, missing };
    }
  };
}

/** Build env presence flags without leaking values. */
export function buildEnvFlags() {
  return {
    supabaseUrlSet:      !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKeySet:         !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKeySet:  !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    anthropicKeySet:    !!process.env.ANTHROPIC_API_KEY,
    nodeEnv:            process.env.NODE_ENV ?? "development"
  };
}
