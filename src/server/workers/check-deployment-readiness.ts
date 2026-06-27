/**
 * Deployment readiness check.
 *
 * Run with: pnpm deploy:check
 *          (tsx src/server/workers/check-deployment-readiness.ts)
 *
 * Verifies that the environment and Supabase schema are ready for production.
 * Exits 0 on full pass, 1 on any failure.
 * Never prints secret values — only field names and safe status strings.
 */

import { loadLocalEnv } from "./load-env";
import { validateWorkerEnv } from "./worker-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface CheckResult {
  name:    string;
  pass:    boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass, detail });
  const icon = pass ? "✓" : "✗";
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`  ${icon} ${name}${suffix}`);
}

async function run(): Promise<void> {
  console.log("\n=== CompliAgent Deployment Readiness Check ===\n");

  // 1. Load local .env (no-op in Railway)
  loadLocalEnv();

  // 2. Required environment variables
  console.log("Environment variables:");
  try {
    const env = validateWorkerEnv();
    record("Required env vars present", true);
    record(
      "NEXT_PUBLIC_SUPABASE_URL configured",
      Boolean(env.NEXT_PUBLIC_SUPABASE_URL)
    );
    record(
      "SUPABASE_SERVICE_ROLE_KEY configured",
      Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
    );
    record(
      "SUPABASE_STORAGE_BUCKET_DOCUMENTS",
      true,
      env.SUPABASE_STORAGE_BUCKET_DOCUMENTS
    );
  } catch (err) {
    record(
      "Required env vars present",
      false,
      err instanceof Error ? err.message : "Configuration error"
    );
    console.error("\nCannot proceed: required environment variables are missing.");
    process.exit(1);
  }

  // 3. Supabase admin client
  console.log("\nSupabase admin client:");
  const admin = createSupabaseAdminClient();
  if (!admin) {
    record("Admin client created", false, "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    console.error("\nCannot proceed: Supabase admin client could not be created.");
    process.exit(1);
  }
  record("Admin client created", true);

  // 4. Database connectivity
  console.log("\nDatabase connectivity:");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from("documents").select("id").limit(1);
    record("Database reachable", !error, error?.message);
  } catch {
    record("Database reachable", false, "Connection failed");
  }

  // 5. Required tables
  console.log("\nRequired tables:");
  const requiredTables = [
    "organizations",
    "profiles",
    "projects",
    "documents",
    "processing_jobs",
    "worker_liveness",
    "compliance_reviews",
    "compliance_findings",
  ];
  for (const table of requiredTables) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any).from(table).select("*").limit(0);
      record(`Table: ${table}`, !error, error?.message?.slice(0, 80));
    } catch {
      record(`Table: ${table}`, false, "Query failed");
    }
  }

  // 6. Required RPCs
  // PostgREST (v12+) returns PGRST202 when argument names don't match any
  // function overload — even if the function exists. Calling with the correct
  // parameter names ensures PostgREST resolves the function; a PostgreSQL
  // execution error (wrong values, auth, etc.) confirms the function exists.
  console.log("\nRequired RPCs:");
  const NULL_UUID = "00000000-0000-0000-0000-000000000000";
  type RpcDef = { name: string; args: Record<string, unknown> };
  const rpcDefs: RpcDef[] = [
    {
      name: "claim_processing_job",
      args: { p_worker_id: "check", p_job_type: "document_extraction" }
    },
    {
      name: "recover_abandoned_processing_jobs",
      args: { p_heartbeat_threshold_minutes: 5, p_worker_id: "check" }
    },
    {
      name: "replace_document_extraction_transactionally",
      args: {
        p_document_id: NULL_UUID, p_organization_id: NULL_UUID,
        p_project_id: NULL_UUID, p_job_id: NULL_UUID,
        p_extraction_version: "check", p_page_count: 0,
        p_ocr_required: false, p_pages: [], p_chunks: [],
        p_created_by: NULL_UUID
      }
    },
    {
      name: "persist_condition_evaluation_and_refresh_parent",
      args: {
        p_organization_id: NULL_UUID, p_project_id: NULL_UUID,
        p_review_id: NULL_UUID, p_finding_id: NULL_UUID,
        p_requirement_id: NULL_UUID, p_requirement_condition_id: NULL_UUID,
        p_status: "complied", p_evidence_summary: "check",
        p_reasoning: "check", p_contradiction_reasoning: null,
        p_missing_information: null, p_verification_failure_reason: null,
        p_contractor_action: null, p_confidence_score: 0,
        p_weightage_score: 0, p_is_human_review_required: false,
        p_evidence_links: [], p_deterministic_parent_status: "complied",
        p_deterministic_parent_reasoning: "check",
        p_deterministic_requires_human_review: false,
        p_created_by: NULL_UUID
      }
    }
  ];

  for (const def of rpcDefs) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any).rpc(def.name, def.args);
      // PGRST202 / 42883 = function truly not found; any other error means it exists.
      const notFound = error?.code === "PGRST202" || error?.code === "42883";
      record(`RPC: ${def.name}`, !notFound, notFound ? "Not found" : undefined);
    } catch {
      record(`RPC: ${def.name}`, false, "Query failed");
    }
  }

  // 7. Storage buckets
  console.log("\nStorage buckets:");
  const docsBucket = process.env.SUPABASE_STORAGE_BUCKET_DOCUMENTS ?? "documents";
  try {
    const { data, error } = await admin.storage.getBucket(docsBucket);
    record(`Bucket: ${docsBucket} exists`, !error && !!data, error?.message?.slice(0, 80));
    if (data) {
      record(
        `Bucket: ${docsBucket} is private`,
        !data.public,
        data.public ? "Bucket is PUBLIC — must be private" : undefined
      );
    }
  } catch {
    record(`Bucket: ${docsBucket} exists`, false, "Query failed");
  }

  // 8. Summary
  const failures = results.filter((r) => !r.pass);
  console.log(`\n${results.length} checks, ${failures.length} failure(s).\n`);

  if (failures.length > 0) {
    console.error("Deployment readiness check FAILED:");
    for (const f of failures) {
      console.error(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    }
    process.exit(1);
  } else {
    console.log("Deployment readiness check PASSED. The environment is ready.");
    process.exit(0);
  }
}

run().catch((err: unknown) => {
  console.error(
    "Unexpected error:",
    err instanceof Error ? err.message.slice(0, 200) : "Unknown error"
  );
  process.exit(1);
});
