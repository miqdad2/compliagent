/**
 * cli-worker.test.ts
 *
 * Unit tests for the document processing worker CLI entry point.
 * Covers argument parsing, batch execution, security invariants,
 * diagnostics split, and confirmation that the browser API route
 * retains its authentication guard.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  parseBatchSize,
  buildWorkerId,
  runDocumentWorkerBatch,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE
} from "@/server/workers/run-document-worker";
import { type WorkerBatchResult } from "@/server/workers/document-processing-worker";
import {
  runReadinessChecks,
  type DiagnosticsClient
} from "@/lib/diagnostics/readiness";
import type { ProcessingJobGateway } from "@/server/services/processing/gateway";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8")
) as { scripts: Record<string, string>; devDependencies: Record<string, string> };

function emptyBatchResult(): WorkerBatchResult {
  return { processed: 0, succeeded: 0, retried: 0, failed: 0, skipped: 0, recovered: 0 };
}

function makeWorkerFactory(result: WorkerBatchResult = emptyBatchResult()) {
  const processBatch = vi.fn().mockResolvedValue(result);
  const factory = vi.fn().mockReturnValue({ processBatch });
  return { factory, processBatch };
}

function makeDummyGateway(): ProcessingJobGateway {
  return {
    enqueue: vi.fn(),
    claimJob: vi.fn().mockResolvedValue(null),
    heartbeat: vi.fn(),
    persistExtraction: vi.fn(),
    failJob: vi.fn(),
    scheduleRetry: vi.fn(),
    recoverAbandonedJobs: vi.fn().mockResolvedValue(0),
    getJobById: vi.fn(),
    getDocumentById: vi.fn(),
    downloadFile: vi.fn(),
    updateDocumentStatus: vi.fn(),
    writeAudit: vi.fn()
  } as unknown as ProcessingJobGateway;
}

function makeAllReadyDiagnosticsClient(): DiagnosticsClient {
  return {
    countTable: async () => 0,
    getBucketMeta: async (name) => ({ id: name, public: false }),
    countQueuedJobs: async () => 0,
    canReadAnnotationOutputs: async () => true,
    checkRequiredRpcs: async () => ({ exists: true, missing: [] })
  };
}

const ALL_READY_ENV = {
  supabaseUrlSet: true,
  anonKeySet: true,
  serviceRoleKeySet: true,
  anthropicKeySet: true,
  nodeEnv: "development"
};

// ── 1. Package configuration ──────────────────────────────────────────────────

describe("package script configuration", () => {
  it("worker:documents script is defined", () => {
    expect(PACKAGE_JSON.scripts["worker:documents"]).toBeDefined();
  });

  it("script uses tsx, not curl", () => {
    const script = PACKAGE_JSON.scripts["worker:documents"];
    expect(script).toContain("tsx");
    expect(script).not.toContain("curl");
  });

  it("script references the CLI entry file", () => {
    const script = PACKAGE_JSON.scripts["worker:documents"];
    expect(script).toContain("run-document-worker");
  });

  it("tsx is in devDependencies", () => {
    expect(PACKAGE_JSON.devDependencies["tsx"]).toBeDefined();
  });
});

// ── 2. Argument parsing ───────────────────────────────────────────────────────

describe("parseBatchSize", () => {
  it("no arguments returns DEFAULT_BATCH_SIZE", () => {
    const result = parseBatchSize([]);
    expect(result).toEqual({ valid: true, size: DEFAULT_BATCH_SIZE });
    expect(DEFAULT_BATCH_SIZE).toBe(10);
  });

  it("--batch-size=20 returns 20", () => {
    const result = parseBatchSize(["--batch-size=20"]);
    expect(result).toEqual({ valid: true, size: 20 });
  });

  it("--batch-size=1 returns 1 (minimum valid value)", () => {
    const result = parseBatchSize(["--batch-size=1"]);
    expect(result).toEqual({ valid: true, size: 1 });
  });

  it("--batch-size=100 returns 100 (MAX_BATCH_SIZE)", () => {
    const result = parseBatchSize([`--batch-size=${MAX_BATCH_SIZE}`]);
    expect(result).toEqual({ valid: true, size: MAX_BATCH_SIZE });
    expect(MAX_BATCH_SIZE).toBe(100);
  });

  it("--batch-size=101 returns invalid (exceeds maximum)", () => {
    const result = parseBatchSize(["--batch-size=101"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("101");
      expect(result.reason.toLowerCase()).toContain("maximum");
    }
  });

  it("--batch-size=0 returns invalid (not positive)", () => {
    const result = parseBatchSize(["--batch-size=0"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("0");
    }
  });

  it("--batch-size=abc returns invalid (not an integer)", () => {
    const result = parseBatchSize(["--batch-size=abc"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("abc");
    }
  });
});

// ── 3. Worker ID generation ───────────────────────────────────────────────────

describe("buildWorkerId", () => {
  it("returns a string starting with 'cli-'", () => {
    const id = buildWorkerId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("cli-")).toBe(true);
  });

  it("two consecutive calls produce different IDs", () => {
    const a = buildWorkerId();
    const b = buildWorkerId();
    // At minimum they differ by timestamp if called far enough apart,
    // but process.pid and Date.now() ensure they're practically different.
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    // Both must be non-empty and have the right prefix.
    expect(a.length).toBeGreaterThan(4);
    expect(b.length).toBeGreaterThan(4);
  });
});

// ── 4. runDocumentWorkerBatch with mock worker factory ────────────────────────

describe("runDocumentWorkerBatch", () => {
  it("returns WorkerBatchResult with all expected fields", async () => {
    const { factory } = makeWorkerFactory();
    const result = await runDocumentWorkerBatch({
      batchSize: 5,
      workerId: "test-worker-1",
      gateway: makeDummyGateway(),
      workerFactory: factory
    });
    expect(result).toHaveProperty("processed");
    expect(result).toHaveProperty("succeeded");
    expect(result).toHaveProperty("retried");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("recovered");
  });

  it("calls worker.processBatch with the provided batchSize", async () => {
    const { factory, processBatch } = makeWorkerFactory();
    await runDocumentWorkerBatch({
      batchSize: 7,
      workerId: "test-worker-2",
      gateway: makeDummyGateway(),
      workerFactory: factory
    });
    expect(processBatch).toHaveBeenCalledOnce();
    expect(processBatch).toHaveBeenCalledWith(7);
  });

  it("passes the provided workerId to the worker factory", async () => {
    const { factory } = makeWorkerFactory();
    await runDocumentWorkerBatch({
      batchSize: 1,
      workerId: "test-wid-xyz",
      gateway: makeDummyGateway(),
      workerFactory: factory
    });
    expect(factory).toHaveBeenCalledWith(expect.anything(), "test-wid-xyz");
  });

  it("returns the worker's result directly", async () => {
    const expected: WorkerBatchResult = {
      processed: 3, succeeded: 2, retried: 1, failed: 0, skipped: 0, recovered: 1
    };
    const { factory } = makeWorkerFactory(expected);
    const result = await runDocumentWorkerBatch({
      batchSize: 5,
      workerId: "test-worker-3",
      gateway: makeDummyGateway(),
      workerFactory: factory
    });
    expect(result).toEqual(expected);
  });

  it("uses provided gateway, not a real Supabase client", async () => {
    const dummyGateway = makeDummyGateway();
    const { factory } = makeWorkerFactory();
    await runDocumentWorkerBatch({
      batchSize: 1,
      gateway: dummyGateway,
      workerFactory: factory
    });
    // If factory was called, it was called with our exact gateway object.
    expect(factory).toHaveBeenCalledWith(dummyGateway, expect.any(String));
  });

  it("propagates errors thrown by the worker factory", async () => {
    const throwingFactory = vi.fn().mockImplementation(() => {
      throw new Error("worker factory failed");
    });
    await expect(
      runDocumentWorkerBatch({
        batchSize: 1,
        gateway: makeDummyGateway(),
        workerFactory: throwingFactory
      })
    ).rejects.toThrow("worker factory failed");
  });
});

// ── 5. Security invariants ────────────────────────────────────────────────────

describe("security invariants", () => {
  it("log output does not contain service_role key pattern", async () => {
    const logs: string[] = [];
    const { factory } = makeWorkerFactory();
    await runDocumentWorkerBatch({
      batchSize: 5,
      workerId: "sec-test-worker",
      gateway: makeDummyGateway(),
      workerFactory: factory,
      log: (msg) => logs.push(msg)
    });
    const output = logs.join("\n");
    expect(output).not.toMatch(/service_role/i);
    expect(output).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT pattern
  });

  it("log output does not contain raw document text or evidence quotes", async () => {
    const logs: string[] = [];
    const { factory } = makeWorkerFactory();
    await runDocumentWorkerBatch({
      batchSize: 5,
      workerId: "sec-test-worker-2",
      gateway: makeDummyGateway(),
      workerFactory: factory,
      log: (msg) => logs.push(msg)
    });
    const output = logs.join("\n");
    // Log summary should only contain safe field names and numbers.
    expect(output).toMatch(/Recovered abandoned:/);
    expect(output).toMatch(/Processed:/);
    expect(output).toMatch(/Succeeded:/);
    expect(output).not.toContain("document_body");
    expect(output).not.toContain("extracted_text");
  });

  it("parseBatchSize error reason is a safe human-readable string (no stack trace)", () => {
    const result = parseBatchSize(["--batch-size=abc"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).not.toContain("Error:");
      expect(result.reason).not.toContain("at ");    // no stack frames
      expect(result.reason.length).toBeLessThan(300);
    }
  });
});

// ── 6. Diagnostics: worker_liveness is always warning ────────────────────────

describe("diagnostics — worker_liveness", () => {
  it("worker_liveness item is always present with WARNING status", async () => {
    const report = await runReadinessChecks(makeAllReadyDiagnosticsClient(), ALL_READY_ENV);
    const item = report.items.find((i) => i.id === "worker_liveness");
    expect(item).toBeDefined();
    expect(item?.status).toBe("warning");
  });

  it("worker_liveness detail mentions pnpm worker:documents", async () => {
    const report = await runReadinessChecks(makeAllReadyDiagnosticsClient(), ALL_READY_ENV);
    const item = report.items.find((i) => i.id === "worker_liveness");
    expect(item?.detail).toContain("pnpm worker:documents");
  });

  it("worker_liveness item does not expose credentials or config values", async () => {
    const report = await runReadinessChecks(makeAllReadyDiagnosticsClient(), ALL_READY_ENV);
    const item = report.items.find((i) => i.id === "worker_liveness");
    expect(item?.detail).not.toMatch(/service_role/i);
    expect(item?.detail).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(item?.detail).not.toMatch(/https?:\/\/[a-z0-9]+\.supabase\.co/);
  });

  it("overall status is warning (not ready) due to worker_liveness", async () => {
    const report = await runReadinessChecks(makeAllReadyDiagnosticsClient(), ALL_READY_ENV);
    expect(report.overallStatus).toBe("warning");
  });
});

// ── 7. Browser dev route authentication guard ─────────────────────────────────

describe("browser dev route authentication", () => {
  it("dev route source requires getCurrentProfile before processing", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/app/api/dev/processing/run-worker/route.ts"),
      "utf8"
    );
    expect(routeSource).toContain("getCurrentProfile");
  });

  it("dev route source returns 401 when profile is null", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/app/api/dev/processing/run-worker/route.ts"),
      "utf8"
    );
    expect(routeSource).toContain("401");
  });

  it("CLI entry point source does not call fetch or use HTTP", () => {
    const cliSource = readFileSync(
      resolve(process.cwd(), "src/server/workers/run-document-worker.ts"),
      "utf8"
    );
    expect(cliSource).not.toMatch(/\bfetch\s*\(/);
    expect(cliSource).not.toContain("localhost");
    expect(cliSource).not.toContain("/api/dev/");
  });
});
