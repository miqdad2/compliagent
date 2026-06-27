/**
 * Server-side system readiness diagnostics.
 *
 * Never exposes service-role keys, access tokens, raw credentials, or full
 * connection strings. Each check returns only a safe label, status, and detail.
 *
 * Accepts an injectable DiagnosticsClient for testability.
 */

export type ReadinessStatus = "ready" | "warning" | "blocked";

export type ReadinessItem = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
};

export type ReadinessReport = {
  items: ReadinessItem[];
  overallStatus: ReadinessStatus;
  checkedAt: string;
};

export type StorageBucketMeta = {
  id: string;
  public: boolean;
};

/** Injected interface — kept minimal so tests can provide simple stubs. */
export type DiagnosticsClient = {
  /** Count rows in a public-schema table; returns null if inaccessible. */
  countTable(tableName: string): Promise<number | null>;
  /** Return bucket existence and privacy; null if not found. */
  getBucketMeta(bucketName: string): Promise<StorageBucketMeta | null>;
  /** Return number of queued/claimed processing jobs. */
  countQueuedJobs(): Promise<number>;
  /** True if annotation_outputs is accessible (no RLS error). */
  canReadAnnotationOutputs(): Promise<boolean>;
  /** Probe each RPC name — any probe that returns "function not found" → missing. */
  checkRequiredRpcs(rpcNames: string[]): Promise<{ exists: boolean; missing: string[] }>;
};

function makeItem(
  id: string,
  label: string,
  status: ReadinessStatus,
  detail: string
): ReadinessItem {
  return { id, label, status, detail };
}

function worstStatus(items: ReadinessItem[]): ReadinessStatus {
  if (items.some((i) => i.status === "blocked")) return "blocked";
  if (items.some((i) => i.status === "warning")) return "warning";
  return "ready";
}

const REQUIRED_RPCS = [
  "claim_processing_job",
  "replace_document_extraction_transactionally",
  "persist_condition_evaluation_and_refresh_parent"
];

const REQUIRED_TABLES: Array<{ name: string; label: string }> = [
  { name: "processing_jobs",       label: "Document processing jobs" },
  { name: "extracted_requirements", label: "Extracted requirements" },
  { name: "compliance_findings",   label: "Compliance findings" },
  { name: "condition_evaluations", label: "Condition evaluations" },
  { name: "annotation_outputs",    label: "Annotation outputs" }
];

export async function runReadinessChecks(
  client: DiagnosticsClient,
  env: {
    supabaseUrlSet: boolean;
    anonKeySet: boolean;
    serviceRoleKeySet: boolean;
    anthropicKeySet: boolean;
    nodeEnv: string;
  }
): Promise<ReadinessReport> {
  const items: ReadinessItem[] = [];

  // ── Environment variables (presence only — values are never shown) ──────────

  items.push(
    env.supabaseUrlSet
      ? makeItem("env_url", "Supabase URL", "ready", "NEXT_PUBLIC_SUPABASE_URL is configured.")
      : makeItem("env_url", "Supabase URL", "blocked", "NEXT_PUBLIC_SUPABASE_URL is missing. Set it in .env.local.")
  );

  items.push(
    env.anonKeySet
      ? makeItem("env_anon", "Supabase anon key", "ready", "NEXT_PUBLIC_SUPABASE_ANON_KEY is configured.")
      : makeItem("env_anon", "Supabase anon key", "blocked", "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Set it in .env.local.")
  );

  items.push(
    env.serviceRoleKeySet
      ? makeItem("env_service", "Service-role key", "ready", "SUPABASE_SERVICE_ROLE_KEY is configured (server-only).")
      : makeItem("env_service", "Service-role key", "blocked", "SUPABASE_SERVICE_ROLE_KEY is missing. Server-side operations will fail.")
  );

  items.push(
    env.anthropicKeySet
      ? makeItem("env_ai", "Anthropic API key", "ready", "ANTHROPIC_API_KEY is configured. Controlled live AI mode is available if org consent is granted.")
      : makeItem("env_ai", "Anthropic API key", "warning", "ANTHROPIC_API_KEY is not set. Deterministic and mock modes still work. Live AI mode is unavailable.")
  );

  // ── Database connectivity ────────────────────────────────────────────────────

  let dbConnected = false;
  try {
    const count = await client.countTable("compliance_reviews");
    dbConnected = count !== null;
    items.push(
      dbConnected
        ? makeItem("db_connection", "Database connection", "ready", "Connected to Supabase PostgreSQL.")
        : makeItem("db_connection", "Database connection", "blocked", "Could not query compliance_reviews. Check Supabase project status and credentials.")
    );
  } catch {
    items.push(makeItem("db_connection", "Database connection", "blocked", "Database connection attempt threw an error. Check Supabase credentials."));
  }

  // ── Tables (only check when DB is reachable) ─────────────────────────────────

  if (dbConnected) {
    for (const { name, label } of REQUIRED_TABLES) {
      try {
        const count = await client.countTable(name);
        items.push(
          count !== null
            ? makeItem(`table_${name}`, `Table: ${label}`, "ready", `${name} is accessible.`)
            : makeItem(`table_${name}`, `Table: ${label}`, "blocked", `${name} is not accessible. Apply any pending migrations.`)
        );
      } catch {
        items.push(makeItem(`table_${name}`, `Table: ${label}`, "blocked", `${name} query failed. Apply pending migrations.`));
      }
    }

    // ── RPC functions ─────────────────────────────────────────────────────────

    try {
      const rpcs = await client.checkRequiredRpcs(REQUIRED_RPCS);
      items.push(
        rpcs.exists
          ? makeItem("rpc_functions", "RPC functions", "ready", "All required PostgreSQL RPC functions are present.")
          : makeItem("rpc_functions", "RPC functions", "blocked", `Missing RPC functions: ${rpcs.missing.join(", ")}. Apply the relevant migrations.`)
      );
    } catch {
      items.push(makeItem("rpc_functions", "RPC functions", "warning", "Could not verify RPC functions. Apply all migrations before running reviews."));
    }

    // ── Annotation outputs RLS ────────────────────────────────────────────────

    try {
      const canRead = await client.canReadAnnotationOutputs();
      items.push(
        canRead
          ? makeItem("rls_annotations", "Annotation outputs RLS", "ready", "annotation_outputs is accessible via the admin client.")
          : makeItem("rls_annotations", "Annotation outputs RLS", "warning", "annotation_outputs is not readable. Verify RLS policies on the annotation_outputs table.")
      );
    } catch {
      items.push(makeItem("rls_annotations", "Annotation outputs RLS", "warning", "Could not verify annotation_outputs accessibility."));
    }

    // ── Processing queue depth ────────────────────────────────────────────────

    try {
      const queued = await client.countQueuedJobs();
      items.push(
        queued > 0
          ? makeItem("worker_queue", "Queue depth", "warning",
              `${queued} document processing job(s) queued and waiting. Run \`pnpm worker:documents\` or click "Trigger document processing" below.`)
          : makeItem("worker_queue", "Queue depth", "ready", "No pending document processing jobs.")
      );
    } catch {
      items.push(makeItem("worker_queue", "Queue depth", "warning", "Could not check the job queue. Jobs may exist but cannot be confirmed."));
    }

    // ── Worker liveness ───────────────────────────────────────────────────────
    // No persistent worker process exists — liveness cannot be confirmed by
    // checking the queue schema or job counts alone.

    items.push(
      makeItem(
        "worker_liveness",
        "Worker liveness",
        "warning",
        "Continuous worker liveness cannot be confirmed. Run `pnpm worker:documents` to process queued jobs, or set up a persistent worker process."
      )
    );
  }

  // ── Storage buckets ──────────────────────────────────────────────────────────

  try {
    const docsBucket = await client.getBucketMeta("documents");
    if (!docsBucket) {
      items.push(makeItem("bucket_documents", "Documents bucket", "blocked",
        "The 'documents' storage bucket does not exist. Create a private bucket named 'documents' in Supabase Storage."));
    } else if (docsBucket.public) {
      items.push(makeItem("bucket_documents", "Documents bucket", "blocked",
        "The 'documents' bucket is PUBLIC. Original source documents must be private. Change it to private in Supabase Storage settings immediately."));
    } else {
      items.push(makeItem("bucket_documents", "Documents bucket", "ready", "Private 'documents' bucket exists and is accessible."));
    }
  } catch {
    items.push(makeItem("bucket_documents", "Documents bucket", "warning", "Could not verify the 'documents' bucket. Check Supabase Storage."));
  }

  try {
    const exportsBucket = await client.getBucketMeta("exports");
    if (!exportsBucket) {
      items.push(makeItem("bucket_exports", "Exports bucket", "blocked",
        "The 'exports' storage bucket does not exist. Create a private bucket named 'exports' in Supabase Storage for annotated PDF outputs."));
    } else if (exportsBucket.public) {
      items.push(makeItem("bucket_exports", "Exports bucket privacy", "blocked",
        "The 'exports' bucket is PUBLIC. Annotated PDFs must remain private. Change it to private in Supabase Storage settings immediately."));
    } else {
      items.push(makeItem("bucket_exports", "Exports bucket", "ready", "Private 'exports' bucket exists and is accessible."));
    }
  } catch {
    items.push(makeItem("bucket_exports", "Exports bucket", "blocked", "Could not verify the 'exports' bucket. Check Supabase Storage."));
  }

  // ── Production guard ──────────────────────────────────────────────────────────

  if (env.nodeEnv === "production") {
    items.push(makeItem("dev_guard", "Development diagnostics in production", "warning",
      "This diagnostics page is running in a production environment. No secrets are exposed, but restrict access with ENABLE_DEV_DIAGNOSTICS=false."));
  } else {
    items.push(makeItem("dev_guard", "Development mode", "ready", "Running in development. This page is dev-only and correctly excluded from production builds by default."));
  }

  return {
    items,
    overallStatus: worstStatus(items),
    checkedAt: new Date().toISOString()
  };
}
