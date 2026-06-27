/**
 * watch-worker.test.ts
 *
 * Regression tests for Unit 17K: Continuous Document Worker.
 *
 * Test strategy:
 *  - Source-file inspection for structural contracts (CLI, package.json, env vars,
 *    route enrichment, progress-client messaging).
 *  - Direct function invocation for pure / injectable functions
 *    (parseWatchWorkerConfig, runWatchWorkerLoop, createStopSignal).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseWatchWorkerConfig,
  createStopSignal,
  runWatchWorkerLoop,
  DEFAULT_WATCH_BATCH_SIZE,
  MAX_WATCH_BATCH_SIZE,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_IDLE_BACKOFF_MS
} from "@/server/workers/watch-document-worker";
import type { WorkerBatchResult } from "@/server/workers/document-processing-worker";

const ROOT = resolve(__dirname, "../..");

function readSrc(rel: string): string {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

const noopSleep = async () => {};
const emptyResult: WorkerBatchResult = {
  processed: 0, succeeded: 0, retried: 0, failed: 0, skipped: 0, recovered: 0
};
const workResult: WorkerBatchResult = {
  processed: 2, succeeded: 2, retried: 0, failed: 0, skipped: 0, recovered: 0
};

// ── 1. parseWatchWorkerConfig ─────────────────────────────────────────────────

describe("Unit 17K: parseWatchWorkerConfig — defaults", () => {
  it("returns DEFAULT_WATCH_BATCH_SIZE when env is empty", () => {
    const cfg = parseWatchWorkerConfig({});
    expect(cfg.batchSize).toBe(DEFAULT_WATCH_BATCH_SIZE);
  });

  it("reads WORKER_DOCUMENT_BATCH_SIZE from env", () => {
    const cfg = parseWatchWorkerConfig({ WORKER_DOCUMENT_BATCH_SIZE: "20" });
    expect(cfg.batchSize).toBe(20);
  });

  it("reads WORKER_DOCUMENT_POLL_INTERVAL_MS from env", () => {
    const cfg = parseWatchWorkerConfig({ WORKER_DOCUMENT_POLL_INTERVAL_MS: "1500" });
    expect(cfg.pollIntervalMs).toBe(1500);
  });

  it("reads WORKER_DOCUMENT_IDLE_BACKOFF_MS from env", () => {
    const cfg = parseWatchWorkerConfig({ WORKER_DOCUMENT_IDLE_BACKOFF_MS: "8000" });
    expect(cfg.idleBackoffMs).toBe(8000);
  });

  it("falls back to DEFAULT_WATCH_BATCH_SIZE when batch size exceeds MAX_WATCH_BATCH_SIZE", () => {
    const cfg = parseWatchWorkerConfig({ WORKER_DOCUMENT_BATCH_SIZE: String(MAX_WATCH_BATCH_SIZE + 1) });
    expect(cfg.batchSize).toBe(DEFAULT_WATCH_BATCH_SIZE);
  });
});

// ── 2. Watch worker file structure (source inspection) ────────────────────────

describe("Unit 17K: Watch worker source structure", () => {
  const src = readSrc("src/server/workers/watch-document-worker.ts");

  it("watch-document-worker.ts file exists", () => {
    expect(existsSync(resolve(ROOT, "src/server/workers/watch-document-worker.ts"))).toBe(true);
  });

  it("does not import from Next.js or HTTP modules", () => {
    expect(src).not.toContain("from \"next/");
    expect(src).not.toContain("from 'next/");
    expect(src).not.toContain("NextResponse");
  });

  it("exports runWatchWorkerLoop function", () => {
    expect(src).toContain("export async function runWatchWorkerLoop");
  });

  it("exports parseWatchWorkerConfig function", () => {
    expect(src).toContain("export function parseWatchWorkerConfig");
  });
});

// ── 3. runWatchWorkerLoop actual behavior ─────────────────────────────────────

describe("Unit 17K: runWatchWorkerLoop behavior", () => {
  it("runs one batch before stopping", async () => {
    const sig = createStopSignal();
    let callCount = 0;
    await runWatchWorkerLoop({
      config:     { batchSize: 5, pollIntervalMs: 0, idleBackoffMs: 0 },
      runBatch:   async () => { callCount++; sig.stop(); return workResult; },
      stopSignal: sig,
      sleep:      noopSleep,
      log:        () => {}
    });
    expect(callCount).toBe(1);
  });

  it("does not run any batch when pre-stopped", async () => {
    const sig = createStopSignal();
    sig.stop();
    let callCount = 0;
    await runWatchWorkerLoop({
      config:     { batchSize: 5, pollIntervalMs: 0, idleBackoffMs: 0 },
      runBatch:   async () => { callCount++; return emptyResult; },
      stopSignal: sig,
      sleep:      noopSleep,
      log:        () => {}
    });
    expect(callCount).toBe(0);
  });

  it("continues after a batch error and completes cleanly", async () => {
    const sig = createStopSignal();
    let callCount = 0;
    const runBatch = async (): Promise<WorkerBatchResult> => {
      callCount++;
      if (callCount === 1) throw new Error("Simulated batch failure");
      sig.stop();
      return workResult;
    };
    await expect(
      runWatchWorkerLoop({
        config:     { batchSize: 5, pollIntervalMs: 0, idleBackoffMs: 0 },
        runBatch,
        stopSignal: sig,
        sleep:      noopSleep,
        log:        () => {}
      })
    ).resolves.toBeUndefined();
    expect(callCount).toBe(2);
  });

  it("logs a cycle summary when batch processed > 0", async () => {
    const sig  = createStopSignal();
    const logs: string[] = [];
    await runWatchWorkerLoop({
      config:     { batchSize: 5, pollIntervalMs: 0, idleBackoffMs: 0 },
      runBatch:   async () => { sig.stop(); return workResult; },
      stopSignal: sig,
      sleep:      noopSleep,
      log:        (msg) => logs.push(msg)
    });
    expect(logs.some((l) => l.includes("processed=2"))).toBe(true);
  });

  it("does not log a cycle summary when queue is empty", async () => {
    const sig  = createStopSignal();
    const logs: string[] = [];
    await runWatchWorkerLoop({
      config:     { batchSize: 5, pollIntervalMs: 0, idleBackoffMs: 0 },
      runBatch:   async () => { sig.stop(); return emptyResult; },
      stopSignal: sig,
      sleep:      noopSleep,
      log:        (msg) => logs.push(msg)
    });
    // No [cycle N] lines — only "Starting." and "Stopped."
    expect(logs.filter((l) => l.includes("[cycle")).length).toBe(0);
  });
});

// ── 4. package.json script and .env.example ───────────────────────────────────

describe("Unit 17K: package.json script", () => {
  const pkg = readSrc("package.json");

  it("worker:documents:watch script exists in package.json", () => {
    expect(pkg).toContain("worker:documents:watch");
  });

  it("script points to watch-document-worker.ts", () => {
    expect(pkg).toContain("watch-document-worker.ts");
  });
});

describe("Unit 17K: .env.example worker variables", () => {
  const env = readSrc(".env.example");

  it("WORKER_DOCUMENT_BATCH_SIZE is in .env.example", () => {
    expect(env).toContain("WORKER_DOCUMENT_BATCH_SIZE");
  });

  it("WORKER_DOCUMENT_POLL_INTERVAL_MS is in .env.example", () => {
    expect(env).toContain("WORKER_DOCUMENT_POLL_INTERVAL_MS");
  });

  it("WORKER_DOCUMENT_IDLE_BACKOFF_MS is in .env.example", () => {
    expect(env).toContain("WORKER_DOCUMENT_IDLE_BACKOFF_MS");
  });
});

// ── 5. Watch worker CLI shutdown source inspection ────────────────────────────

describe("Unit 17K: Watch worker CLI shutdown handling", () => {
  const src = readSrc("src/server/workers/watch-document-worker.ts");

  it("SIGINT handler is registered in the CLI block", () => {
    expect(src).toContain(`"SIGINT"`);
    expect(src).toContain("stopSignal.stop");
  });

  it("SIGTERM handler is registered in the CLI block", () => {
    expect(src).toContain(`"SIGTERM"`);
  });

  it("CLI block validates required env vars before starting", () => {
    expect(src).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(src).toContain("process.exit(2)");
  });
});

// ── 6. Processing-status route enrichment ────────────────────────────────────

describe("Unit 17K: Processing-status route enrichment", () => {
  const src = readSrc("src/app/api/projects/[projectId]/processing-status/route.ts");

  it("route returns queuedCount field", () => {
    expect(src).toContain("queuedCount");
  });

  it("route returns stalledCount field for stalled-job detection", () => {
    expect(src).toContain("stalledCount");
    expect(src).toContain("STALL_THRESHOLD_MS");
  });

  it("backward-compat: allDocsReady and processingCount still present", () => {
    expect(src).toContain("allDocsReady");
    expect(src).toContain("processingCount");
  });
});

// ── 7. ProjectProgressClient truthful messaging ───────────────────────────────

describe("Unit 17K: ProjectProgressClient truthful messaging", () => {
  const src = readSrc("src/components/projects/project-progress-client.tsx");

  it("reads queuedCount from processing-status response", () => {
    expect(src).toContain("queuedCount");
    expect(src).toContain("docWorkerState");
  });

  it("shows worker hint when jobs are queued but no worker is active", () => {
    expect(src).toContain("pnpm worker:documents:watch");
    expect(src).toContain(`docWorkerState === "queued"`);
  });

  it("shows stalled-job warning when heartbeat is stale", () => {
    expect(src).toContain(`docWorkerState === "stalled"`);
    expect(src).toContain("Processing stalled");
  });

  it("distinguishes claimed (active) from queued state", () => {
    expect(src).toContain("claimedCount");
    // "active" state is set when claimedCount > 0 (implicit default heading shown)
    expect(src).toContain(`setDocWorkerState("active")`);
  });
});

// ── Constants exported correctly ─────────────────────────────────────────────

describe("Unit 17K: Exported constants", () => {
  it("DEFAULT_WATCH_BATCH_SIZE is 10", () => {
    expect(DEFAULT_WATCH_BATCH_SIZE).toBe(10);
  });

  it("MAX_WATCH_BATCH_SIZE is 100", () => {
    expect(MAX_WATCH_BATCH_SIZE).toBe(100);
  });

  it("DEFAULT_POLL_INTERVAL_MS is 3000", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(3_000);
  });

  it("DEFAULT_IDLE_BACKOFF_MS is 5000", () => {
    expect(DEFAULT_IDLE_BACKOFF_MS).toBe(5_000);
  });
});
