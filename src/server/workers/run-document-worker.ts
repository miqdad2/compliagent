/**
 * CLI entry point for the document processing worker.
 *
 * Run with: pnpm worker:documents [--batch-size=N]
 *          (tsx src/server/workers/run-document-worker.ts)
 *
 * In production (Railway), env vars are injected via process.env — no .env file
 * is required. For local development a .env file is loaded automatically if
 * it exists. Does not use HTTP routes, browser authentication, or Next.js APIs.
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

export const DEFAULT_BATCH_SIZE = 10;
export const MAX_BATCH_SIZE = 100;

// ── Argument parsing ─────────────────────────────────────────────────────────

export type BatchSizeParseResult =
  | { valid: true; size: number }
  | { valid: false; reason: string };

export function parseBatchSize(args: string[]): BatchSizeParseResult {
  for (const arg of args) {
    const match = arg.match(/^--batch-size=(.+)$/);
    if (match) {
      const raw = match[1];
      const value = parseInt(raw, 10);
      if (isNaN(value) || String(value) !== raw) {
        return { valid: false, reason: `Invalid batch size "${raw}". Must be a positive integer.` };
      }
      if (value <= 0) {
        return { valid: false, reason: `Batch size must be a positive integer, got ${value}.` };
      }
      if (value > MAX_BATCH_SIZE) {
        return { valid: false, reason: `Batch size ${value} exceeds maximum of ${MAX_BATCH_SIZE}.` };
      }
      return { valid: true, size: value };
    }
  }
  return { valid: true, size: DEFAULT_BATCH_SIZE };
}

// ── Worker ID ────────────────────────────────────────────────────────────────

export function buildWorkerId(): string {
  const host = hostname().slice(0, 20).replace(/[^a-zA-Z0-9-]/g, "-");
  return `cli-${host}-${process.pid}-${Date.now()}`;
}

// ── Runnable batch function (injectable for tests) ───────────────────────────

export type RunDocumentWorkerBatchOptions = {
  batchSize?: number;
  workerId?: string;
  /** Provide a gateway directly — used in tests to bypass real Supabase. */
  gateway?: ProcessingJobGateway;
  /** Override the worker factory — used in tests to inject a mock worker. */
  workerFactory?: (
    gateway: ProcessingJobGateway,
    workerId: string
  ) => { processBatch(n: number): Promise<WorkerBatchResult> };
  /** Override log output — defaults to console.log. */
  log?: (msg: string) => void;
};

export async function runDocumentWorkerBatch(
  options: RunDocumentWorkerBatchOptions = {}
): Promise<WorkerBatchResult> {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    workerFactory = createDocumentProcessingWorker,
    log = (msg: string) => console.log(msg)
  } = options;

  let gateway = options.gateway;
  if (!gateway) {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw new Error(
        "Could not create Supabase admin client. " +
        "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      );
    }
    gateway = new SupabaseProcessingGateway(admin);
  }

  const workerId = options.workerId ?? buildWorkerId();
  const worker = workerFactory(gateway, workerId);

  log(`Worker ID: ${workerId}`);
  log(`Batch size: ${batchSize}`);

  const result = await worker.processBatch(batchSize);

  log(`Recovered abandoned: ${result.recovered}`);
  log(`Processed: ${result.processed}`);
  log(`Succeeded: ${result.succeeded}`);
  log(`Retried: ${result.retried}`);
  log(`Failed: ${result.failed}`);
  log(`Skipped: ${result.skipped}`);

  return result;
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const entryFile = process.argv[1] ?? "";
const isDirectExecution =
  entryFile.endsWith("run-document-worker.ts") ||
  entryFile.endsWith("run-document-worker.js");

if (isDirectExecution) {
  // Load .env if present locally; no-op in Railway where vars are pre-injected.
  loadLocalEnv();

  const parseResult = parseBatchSize(process.argv.slice(2));
  if (!parseResult.valid) {
    console.error(`Error: ${parseResult.reason}`);
    process.exit(1);
  }

  try {
    validateWorkerEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Worker configuration error.");
    process.exit(2);
  }

  console.log("Document worker started");

  runDocumentWorkerBatch({ batchSize: parseResult.size })
    .then((result) => {
      console.log("Document worker finished");
      if (result.processed === 0) {
        console.log("Queue was empty — no jobs to process.");
      }
      if (result.failed > 0) {
        console.warn(`Warning: ${result.failed} job(s) failed permanently.`);
      }
      process.exit(0);
    })
    .catch((error: unknown) => {
      const safeMessage =
        error instanceof Error
          ? error.message.slice(0, 200)
          : "An unexpected error occurred.";
      console.error(`Worker failed: ${safeMessage}`);
      process.exit(3);
    });
}
