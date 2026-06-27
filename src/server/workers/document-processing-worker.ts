import type { ProcessingJobGateway } from "@/server/services/processing/gateway";
import { DocumentExtractionJobRunner } from "@/server/services/processing/job-runner";
import { nativeDocumentExtractor, type DocumentExtractor } from "@/server/services/processing/document-extractor";

const HEARTBEAT_INTERVAL_MS = 30_000;
const ABANDONED_THRESHOLD_MINUTES = 5;
const DEFAULT_BATCH_SIZE = 5;

export type WorkerBatchResult = {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  skipped: number;
  recovered: number;
};

export class DocumentProcessingWorker {
  private readonly runner: DocumentExtractionJobRunner;
  private stopped = false;

  constructor(
    private readonly gateway: ProcessingJobGateway,
    private readonly workerId: string,
    extractor: DocumentExtractor = nativeDocumentExtractor
  ) {
    this.runner = new DocumentExtractionJobRunner(gateway, extractor);
  }

  stop(): void {
    this.stopped = true;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  async recoverAbandoned(): Promise<number> {
    return this.gateway.recoverAbandonedJobs(ABANDONED_THRESHOLD_MINUTES, this.workerId);
  }

  async processOne(): Promise<WorkerBatchResult> {
    return this.processBatch(1);
  }

  async processBatch(batchSize: number = DEFAULT_BATCH_SIZE): Promise<WorkerBatchResult> {
    const result: WorkerBatchResult = {
      processed: 0,
      succeeded: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
      recovered: 0
    };

    if (this.stopped) {
      return result;
    }

    // Recover abandoned jobs before claiming new ones.
    try {
      result.recovered = await this.gateway.recoverAbandonedJobs(ABANDONED_THRESHOLD_MINUTES, this.workerId);
    } catch {
      // Recovery failure must not prevent processing new jobs.
    }

    for (let i = 0; i < batchSize; i++) {
      if (this.stopped) break;

      const job = await this.gateway.claimJob(this.workerId, "document_extraction");
      if (!job) break;

      result.processed++;

      // Set up a heartbeat interval while the job runs.
      let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
      try {
        heartbeatInterval = setInterval(() => {
          this.gateway.heartbeat(job.id, this.workerId).catch(() => {});
        }, HEARTBEAT_INTERVAL_MS);

        const executionResult = await this.runner.executeJob(job.id, this.workerId);

        clearInterval(heartbeatInterval);
        heartbeatInterval = undefined;

        switch (executionResult.outcome) {
          case "completed":
            result.succeeded++;
            break;
          case "retry":
            result.retried++;
            break;
          case "failed":
            result.failed++;
            break;
          case "skipped":
            result.skipped++;
            break;
        }
      } catch (unexpectedError) {
        if (heartbeatInterval !== undefined) {
          clearInterval(heartbeatInterval);
        }
        result.failed++;
        const safeMsg =
          unexpectedError instanceof Error
            ? `Unexpected error: ${unexpectedError.message.slice(0, 200)}`
            : "An unexpected error occurred in the worker. The job has been permanently failed.";
        try {
          await this.gateway.failJob(job.id, this.workerId, {
            errorCode: "unexpected_worker_error",
            safeMessage: safeMsg
          });
          if (job.document_id) {
            await this.gateway.updateDocumentStatus(job.document_id, "failed");
          }
        } catch {
          // Best effort.
        }
      }
    }

    return result;
  }
}

/** Create a worker backed by the given gateway. Suitable for server-side use. */
export function createDocumentProcessingWorker(
  gateway: ProcessingJobGateway,
  workerId?: string,
  extractor?: DocumentExtractor
): DocumentProcessingWorker {
  const id = workerId ?? `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new DocumentProcessingWorker(gateway, id, extractor);
}
