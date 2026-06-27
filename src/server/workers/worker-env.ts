import { z } from "zod";

/**
 * Zod schema for required worker environment variables.
 * Validated once at startup before any Supabase client is created.
 * Optional numeric vars have defaults handled by parseWatchWorkerConfig.
 */
const workerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_STORAGE_BUCKET_DOCUMENTS: z
    .string()
    .min(1)
    .default("documents"),
  WORKER_DOCUMENT_BATCH_SIZE: z.string().optional(),
  WORKER_DOCUMENT_POLL_INTERVAL_MS: z.string().optional(),
  WORKER_DOCUMENT_IDLE_BACKOFF_MS: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/**
 * Validates required worker environment variables.
 * Throws with a safe message listing missing variable names — never logs values.
 */
export function validateWorkerEnv(
  env: { [key: string]: string | undefined } = process.env
): WorkerEnv {
  const result = workerEnvSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    throw new Error(
      `Worker cannot start — missing or invalid environment variable(s): ${fields}`
    );
  }
  return result.data;
}
