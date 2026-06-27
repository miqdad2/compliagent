/**
 * Continuous document processing worker.
 *
 * Run with: pnpm worker:documents:watch
 *          (tsx src/server/workers/watch-document-worker.ts)
 *
 * In production (Railway), env vars are injected via process.env — no .env file
 * is required. For local development a .env file is loaded automatically when
 * it exists.
 *
 * Environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL        (required)
 *   SUPABASE_SERVICE_ROLE_KEY       (required)
 *   SUPABASE_STORAGE_BUCKET_DOCUMENTS (optional, default: "documents")
 *   WORKER_DOCUMENT_BATCH_SIZE        Max docs per poll cycle (default: 10, max: 100)
 *   WORKER_DOCUMENT_POLL_INTERVAL_MS  Delay after a productive cycle (default: 3000)
 *   WORKER_DOCUMENT_IDLE_BACKOFF_MS   Delay when queue is empty (default: 5000)
 *
 * Designed for long-lived operation. Stops cleanly on SIGINT or SIGTERM after
 * the current batch completes. Does not use HTTP routes, Next.js APIs, browser
 * auth, or cookies. The underlying DocumentProcessingWorker handles all
 * claim / heartbeat / retry / abandoned-job recovery logic.
 *
 * The worker periodically writes a heartbeat to the worker_liveness table so
 * the web application can distinguish active / stale / unknown worker state.
 */

import { hostname } from "node:os";
import { loadLocalEnv } from "./load-env";
import { validateWorkerEnv } from "./worker-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseProcessingGateway } from "@/server/services/processing/supabase-processing-gateway";
import {
  createDocumentProcessingWorker,
  type WorkerBatchResult
} from "@/server/workers/document-processing-worker";
import type { ProcessingJobGateway } from "@/server/services/processing/gateway";

// ── Configuration ─────────────────────────────────────────────────────────────

export const DEFAULT_WATCH_BATCH_SIZE  = 10;
export const MAX_WATCH_BATCH_SIZE      = 100;
export const DEFAULT_POLL_INTERVAL_MS  = 3_000;
export const DEFAULT_IDLE_BACKOFF_MS   = 5_000;

export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const WORKER_TYPE = "document_processing";

export type WatchWorkerConfig = {
  batchSize:      number;
  pollIntervalMs: number;
  idleBackoffMs:  number;
};

export function parseWatchWorkerConfig(
  env: { [key: string]: string | undefined } = process.env
): WatchWorkerConfig {
  const rawBatch = parseInt(env.WORKER_DOCUMENT_BATCH_SIZE ?? "", 10);
  const rawPoll  = parseInt(env.WORKER_DOCUMENT_POLL_INTERVAL_MS ?? "", 10);
  const rawIdle  = parseInt(env.WORKER_DOCUMENT_IDLE_BACKOFF_MS ?? "", 10);

  const batchSize =
    !isNaN(rawBatch) && rawBatch > 0 && rawBatch <= MAX_WATCH_BATCH_SIZE
      ? rawBatch
      : DEFAULT_WATCH_BATCH_SIZE;

  const pollIntervalMs =
    !isNaN(rawPoll) && rawPoll > 0
      ? rawPoll
      : DEFAULT_POLL_INTERVAL_MS;

  const idleBackoffMs =
    !isNaN(rawIdle) && rawIdle > 0
      ? rawIdle
      : DEFAULT_IDLE_BACKOFF_MS;

  return { batchSize, pollIntervalMs, idleBackoffMs };
}

// ── Stop signal ───────────────────────────────────────────────────────────────

/** Read-only view used by the loop to check for stop requests. */
export type StopSignal = {
  readonly stopped: boolean;
};

/** Mutable signal created by the CLI or tests to trigger shutdown. */
export type MutableStopSignal = StopSignal & {
  stop(): void;
};

export function createStopSignal(): MutableStopSignal {
  let _stopped = false;
  return {
    get stopped() { return _stopped; },
    stop() { _stopped = true; }
  };
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

export type WatchWorkerLoopOptions = {
  config:     WatchWorkerConfig;
  /** Injectable batch runner — defaults to the real DocumentProcessingWorker. */
  runBatch:   (batchSize: number) => Promise<WorkerBatchResult>;
  stopSignal: StopSignal;
  /** Injectable sleep — override in tests to avoid real waiting. */
  sleep?:     (ms: number) => Promise<void>;
  log?:       (msg: string) => void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the continuous poll loop until `stopSignal.stopped` is true.
 *
 * The loop awaits each batch sequentially — there is no overlap between
 * batches. On an empty queue the loop backs off using `idleBackoffMs`.
 * On a productive batch it delays `pollIntervalMs`. Batch errors are
 * logged and swallowed so the loop continues.
 */
export async function runWatchWorkerLoop(options: WatchWorkerLoopOptions): Promise<void> {
  const {
    config,
    runBatch,
    stopSignal,
    sleep = defaultSleep,
    log   = (msg: string) => console.log(`[watch-worker] ${msg}`)
  } = options;

  log(
    `Starting. batchSize=${config.batchSize} ` +
    `pollIntervalMs=${config.pollIntervalMs} ` +
    `idleBackoffMs=${config.idleBackoffMs}`
  );

  let cycle = 0;

  while (!stopSignal.stopped) {
    cycle++;

    try {
      const result = await runBatch(config.batchSize);

      const wasIdle = result.processed === 0 && result.recovered === 0;

      if (!wasIdle) {
        log(
          `[cycle ${cycle}] processed=${result.processed} ` +
          `succeeded=${result.succeeded} retried=${result.retried} ` +
          `failed=${result.failed} recovered=${result.recovered}`
        );
      }

      if (stopSignal.stopped) break;
      await sleep(wasIdle ? config.idleBackoffMs : config.pollIntervalMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
      log(`[cycle ${cycle}] Batch error: ${msg}`);
      if (stopSignal.stopped) break;
      await sleep(config.idleBackoffMs);
    }
  }

  log("Stopped.");
}

// ── Gateway builder ───────────────────────────────────────────────────────────

export function buildWatchWorkerId(): string {
  const host = hostname().slice(0, 20).replace(/[^a-zA-Z0-9-]/g, "-");
  return `watch-${host}-${process.pid}-${Date.now()}`;
}

export type BuildBatchRunnerOptions = {
  gateway?:  ProcessingJobGateway;
  workerId?: string;
};

export function buildBatchRunner(
  options: BuildBatchRunnerOptions = {}
): (batchSize: number) => Promise<WorkerBatchResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new Error(
      "Could not create Supabase admin client. " +
      "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  const gateway  = options.gateway  ?? new SupabaseProcessingGateway(admin);
  const workerId = options.workerId ?? buildWatchWorkerId();
  const worker   = createDocumentProcessingWorker(gateway, workerId);
  return (batchSize: number) => worker.processBatch(batchSize);
}

// ── CLI entry point ───────────────────────────────────────────────────────────

const entryFile = process.argv[1] ?? "";
const isDirectExecution =
  entryFile.endsWith("watch-document-worker.ts") ||
  entryFile.endsWith("watch-document-worker.js");

if (isDirectExecution) {
  // Load .env if present locally; no-op in Railway where vars are pre-injected.
  loadLocalEnv();

  // Validate required env vars via Zod — fails fast with safe field-name message.
  let workerEnv: ReturnType<typeof validateWorkerEnv>;
  try {
    workerEnv = validateWorkerEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Worker configuration error.");
    process.exit(2);
  }

  const config     = parseWatchWorkerConfig();
  const stopSignal = createStopSignal();
  const workerId   = buildWatchWorkerId();

  // Startup diagnostics — safe values only; never logs URL or key values.
  console.log("Document watch worker starting (Ctrl+C to stop)…");
  console.log(`  Batch size:          ${config.batchSize}`);
  console.log(`  Poll interval:       ${config.pollIntervalMs}ms`);
  console.log(`  Idle backoff:        ${config.idleBackoffMs}ms`);
  console.log(`  Supabase configuration: ${workerEnv.NEXT_PUBLIC_SUPABASE_URL ? "present" : "missing"}`);
  console.log(`  Documents bucket:    ${workerEnv.SUPABASE_STORAGE_BUCKET_DOCUMENTS} (configured)`);
  console.log(`  Worker ID:           ${workerId}`);

  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT — stopping after current batch…");
    stopSignal.stop();
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM — stopping after current batch…");
    stopSignal.stop();
  });

  // Create admin client for both batch running and heartbeat.
  const admin = createSupabaseAdminClient();
  if (!admin) {
    console.error("Failed to initialize Supabase admin client.");
    process.exit(3);
  }

  const gateway = new SupabaseProcessingGateway(admin);

  function initRunner(): (n: number) => Promise<WorkerBatchResult> {
    try {
      return buildBatchRunner({ gateway, workerId });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message.slice(0, 200) : "Unexpected error during init.";
      console.error(`Failed to initialize worker: ${msg}`);
      process.exit(3);
    }
  }

  const runBatch = initRunner();

  // Heartbeat: upsert a row in worker_liveness every 30 seconds so the web
  // application can distinguish active / stale / unknown worker state.
  const sendHeartbeat = async (): Promise<void> => {
    try {
      await admin.from("worker_liveness").upsert(
        {
          worker_type:       WORKER_TYPE,
          worker_id:         workerId,
          last_heartbeat_at: new Date().toISOString(),
        },
        { onConflict: "worker_type" }
      );
    } catch {
      // Heartbeat failure is non-fatal — processing continues.
    }
  };

  // Send initial heartbeat immediately, then every 30 seconds.
  void sendHeartbeat();
  const heartbeatTimer = setInterval(() => { void sendHeartbeat(); }, WORKER_HEARTBEAT_INTERVAL_MS);

  runWatchWorkerLoop({ config, runBatch, stopSignal })
    .then(() => {
      clearInterval(heartbeatTimer);
      console.log("Document watch worker exited cleanly.");
      process.exit(0);
    })
    .catch((err: unknown) => {
      clearInterval(heartbeatTimer);
      const msg =
        err instanceof Error ? err.message.slice(0, 200) : "An unexpected error occurred.";
      console.error(`Watch worker fatal error: ${msg}`);
      process.exit(3);
    });
}
