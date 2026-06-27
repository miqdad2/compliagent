/**
 * system-readiness.test.ts
 *
 * Unit tests for the system readiness diagnostics service.
 * All checks use an injectable DiagnosticsClient stub — no real Supabase calls.
 * Tests also cover security invariants, production guard, and dev-checklist constraints.
 */

import { describe, it, expect, vi } from "vitest";
import {
  runReadinessChecks,
  type DiagnosticsClient,
  type ReadinessReport
} from "@/lib/diagnostics/readiness";

// ── Stub factory ─────────────────────────────────────────────────────────────

type StubOpts = {
  countTableImpl?: (name: string) => Promise<number | null>;
  getBucketMeta?: DiagnosticsClient["getBucketMeta"];
  countQueuedJobs?: () => Promise<number>;
  canReadAnnotationOutputs?: () => Promise<boolean>;
  checkRequiredRpcs?: DiagnosticsClient["checkRequiredRpcs"];
};

function makeAllReadyClient(overrides: StubOpts = {}): DiagnosticsClient {
  return {
    countTable: overrides.countTableImpl ?? (async () => 0),
    getBucketMeta: overrides.getBucketMeta ?? (async () => ({ id: "documents", public: false })),
    countQueuedJobs: overrides.countQueuedJobs ?? (async () => 0),
    canReadAnnotationOutputs: overrides.canReadAnnotationOutputs ?? (async () => true),
    checkRequiredRpcs: overrides.checkRequiredRpcs ?? (async () => ({ exists: true, missing: [] }))
  };
}

const ALL_READY_ENV = {
  supabaseUrlSet:     true,
  anonKeySet:        true,
  serviceRoleKeySet: true,
  anthropicKeySet:   true,
  nodeEnv:           "development"
};

function findItem(report: ReadinessReport, id: string) {
  return report.items.find((i) => i.id === id);
}

// ── 1. Secrets hidden ─────────────────────────────────────────────────────────

describe("secrets hidden", () => {
  it("reports env vars as present/absent booleans — not values", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    const json = JSON.stringify(report);
    // Values that look like Supabase keys or URLs must not appear.
    expect(json).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT-style key
    expect(json).not.toMatch(/https?:\/\/[a-z0-9]+\.supabase\.co/); // Supabase URL
  });

  it("env check detail mentions the env var NAME without its value", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    const item = findItem(report, "env_url");
    expect(item?.detail).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(item?.detail).not.toMatch(/=\s*[^\s]+/); // no "= somevalue" pattern
  });

  it("ANTHROPIC_API_KEY absence → WARNING (not blocked)", async () => {
    const env = { ...ALL_READY_ENV, anthropicKeySet: false };
    const report = await runReadinessChecks(makeAllReadyClient(), env);
    expect(findItem(report, "env_ai")?.status).toBe("warning");
  });
});

// ── 2. Missing migrations → BLOCKED ──────────────────────────────────────────

describe("missing migration → blocked", () => {
  it("missing table compliance_findings → blocked on that table", async () => {
    const client = makeAllReadyClient({
      countTableImpl: async (name) => (name === "compliance_findings" ? null : 0)
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "table_compliance_findings")?.status).toBe("blocked");
  });

  it("missing RPC → blocked on rpc_functions", async () => {
    const client = makeAllReadyClient({
      checkRequiredRpcs: async () => ({
        exists: false,
        missing: ["claim_processing_job"]
      })
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    const item = findItem(report, "rpc_functions");
    expect(item?.status).toBe("blocked");
    expect(item?.detail).toContain("claim_processing_job");
  });

  it("all required tables present → all table items are ready", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    const tableItems = report.items.filter((i) => i.id.startsWith("table_"));
    expect(tableItems.length).toBeGreaterThan(0);
    for (const item of tableItems) {
      expect(item.status).toBe("ready");
    }
  });
});

// ── 3. Missing exports bucket → BLOCKED ──────────────────────────────────────

describe("missing exports bucket → blocked", () => {
  it("exports bucket absent → blocked", async () => {
    const client = makeAllReadyClient({
      getBucketMeta: async (name) => (name === "exports" ? null : { id: name, public: false })
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "bucket_exports")?.status).toBe("blocked");
  });

  it("documents bucket absent → blocked", async () => {
    const client = makeAllReadyClient({
      getBucketMeta: async (name) => (name === "documents" ? null : { id: name, public: false })
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "bucket_documents")?.status).toBe("blocked");
  });
});

// ── 4. Public exports bucket → BLOCKED ───────────────────────────────────────

describe("public exports bucket → blocked", () => {
  it("public exports bucket → blocked with privacy warning in detail", async () => {
    const client = makeAllReadyClient({
      getBucketMeta: async (name) => ({ id: name, public: name === "exports" })
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    const item = findItem(report, "bucket_exports");
    expect(item?.status).toBe("blocked");
    expect(item?.detail.toLowerCase()).toContain("public");
  });

  it("public documents bucket → blocked", async () => {
    const client = makeAllReadyClient({
      getBucketMeta: async (name) => ({ id: name, public: name === "documents" })
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "bucket_documents")?.status).toBe("blocked");
  });

  it("private exports bucket → ready", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    expect(findItem(report, "bucket_exports")?.status).toBe("ready");
  });
});

// ── 5. Worker-not-running warning ─────────────────────────────────────────────

describe("worker-not-running warning", () => {
  it("queued jobs > 0 → worker queue WARNING", async () => {
    const client = makeAllReadyClient({ countQueuedJobs: async () => 3 });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    const item = findItem(report, "worker_queue");
    expect(item?.status).toBe("warning");
    expect(item?.detail).toContain("3");
  });

  it("zero queued jobs → worker queue ready", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    expect(findItem(report, "worker_queue")?.status).toBe("ready");
  });
});

// ── 6. DB connectivity failure → BLOCKED ─────────────────────────────────────

describe("database connectivity", () => {
  it("countTable returns null for compliance_reviews → db blocked", async () => {
    const client = makeAllReadyClient({
      countTableImpl: async (name) => (name === "compliance_reviews" ? null : 0)
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "db_connection")?.status).toBe("blocked");
  });

  it("countTable throws → db blocked", async () => {
    const client = makeAllReadyClient({
      countTableImpl: async () => { throw new Error("connection refused"); }
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "db_connection")?.status).toBe("blocked");
  });

  it("db connected → subsequent table checks run", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    expect(report.items.some((i) => i.id.startsWith("table_"))).toBe(true);
  });

  it("db not connected → table checks are skipped (items absent)", async () => {
    const client = makeAllReadyClient({
      countTableImpl: async () => null
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(report.items.some((i) => i.id.startsWith("table_"))).toBe(false);
  });
});

// ── 7. Annotation outputs RLS ─────────────────────────────────────────────────

describe("annotation outputs RLS", () => {
  it("canReadAnnotationOutputs false → warning", async () => {
    const client = makeAllReadyClient({ canReadAnnotationOutputs: async () => false });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "rls_annotations")?.status).toBe("warning");
  });

  it("canReadAnnotationOutputs true → ready", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    expect(findItem(report, "rls_annotations")?.status).toBe("ready");
  });
});

// ── 8. Production guard ───────────────────────────────────────────────────────

describe("production guard", () => {
  it("nodeEnv=production → dev_guard WARNING", async () => {
    const env = { ...ALL_READY_ENV, nodeEnv: "production" };
    const report = await runReadinessChecks(makeAllReadyClient(), env);
    expect(findItem(report, "dev_guard")?.status).toBe("warning");
  });

  it("nodeEnv=development → dev_guard ready", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    expect(findItem(report, "dev_guard")?.status).toBe("ready");
  });
});

// ── 9. Overall status aggregation ────────────────────────────────────────────

describe("overall status aggregation", () => {
  it("best-case overallStatus is warning (worker_liveness is always warning)", async () => {
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    // worker_liveness is permanently WARNING — minimum achievable status is "warning".
    expect(report.overallStatus).toBe("warning");
  });

  it("one additional warning → overallStatus remains warning", async () => {
    const env = { ...ALL_READY_ENV, anthropicKeySet: false };
    const report = await runReadinessChecks(makeAllReadyClient(), env);
    expect(report.overallStatus).toBe("warning");
  });

  it("one blocked → overallStatus is blocked even with warnings", async () => {
    const client = makeAllReadyClient({
      getBucketMeta: async (name) => (name === "exports" ? null : { id: name, public: false })
    });
    const env = { ...ALL_READY_ENV, anthropicKeySet: false }; // also has a warning
    const report = await runReadinessChecks(client, env);
    expect(report.overallStatus).toBe("blocked");
  });

  it("report includes checkedAt ISO timestamp", async () => {
    const before = Date.now();
    const report = await runReadinessChecks(makeAllReadyClient(), ALL_READY_ENV);
    const ts = Date.parse(report.checkedAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});

// ── 10. No secrets in report output ──────────────────────────────────────────

describe("no credentials in any report item", () => {
  it("detail fields never contain raw env-var values (sanity check)", async () => {
    const sensitiveEnv = {
      supabaseUrlSet:     true,
      anonKeySet:        true,
      serviceRoleKeySet: true,
      anthropicKeySet:   true,
      nodeEnv:           "development"
    };
    const report = await runReadinessChecks(makeAllReadyClient(), sensitiveEnv);
    for (const item of report.items) {
      // No item should embed what looks like a credential token.
      expect(item.detail).not.toMatch(/sk-ant-[A-Za-z0-9]{10,}/);
      expect(item.detail).not.toMatch(/service_role/);
      expect(item.id).not.toContain("password");
      expect(item.label).not.toMatch(/key.*=|=.*key/i);
    }
  });

  it("checkRequiredRpcs is called with the right function names", async () => {
    const spy = vi.fn(async () => ({ exists: true, missing: [] }));
    const client = makeAllReadyClient({ checkRequiredRpcs: spy });
    await runReadinessChecks(client, ALL_READY_ENV);
    expect(spy).toHaveBeenCalledOnce();
    const firstCall = spy.mock.calls[0] as unknown as [string[]];
    const [rpcNames] = firstCall;
    expect(rpcNames).toContain("claim_processing_job");
    expect(rpcNames).toContain("replace_document_extraction_transactionally");
    expect(rpcNames).toContain("persist_condition_evaluation_and_refresh_parent");
  });
});

// ── 11. checkRequiredRpcs error handling ─────────────────────────────────────

describe("RPC check error handling", () => {
  it("checkRequiredRpcs throws → item status is warning (not blocked)", async () => {
    const client = makeAllReadyClient({
      checkRequiredRpcs: async () => { throw new Error("pg_proc unavailable"); }
    });
    const report = await runReadinessChecks(client, ALL_READY_ENV);
    expect(findItem(report, "rpc_functions")?.status).toBe("warning");
  });
});

// ── 12. Service-role key missing → BLOCKED ───────────────────────────────────

describe("service-role key missing → blocked", () => {
  it("serviceRoleKeySet false → env_service blocked", async () => {
    const env = { ...ALL_READY_ENV, serviceRoleKeySet: false };
    const report = await runReadinessChecks(makeAllReadyClient(), env);
    expect(findItem(report, "env_service")?.status).toBe("blocked");
  });

  it("supabaseUrlSet false → env_url blocked", async () => {
    const env = { ...ALL_READY_ENV, supabaseUrlSet: false };
    const report = await runReadinessChecks(makeAllReadyClient(), env);
    expect(findItem(report, "env_url")?.status).toBe("blocked");
  });
});
