import type {
  DocumentRow,
  EnqueueJobInput,
  FailInput,
  PersistExtractionInput,
  PersistExtractionResult,
  ProcessingAuditRecord,
  ProcessingJobRow,
  RetryInput
} from "./types";

export interface ProcessingJobGateway {
  /** Create a new queued job and return it. */
  enqueue(input: EnqueueJobInput): Promise<ProcessingJobRow>;

  /** Atomically claim the oldest available job for the given worker.
   *  Returns null if no job is available. */
  claimJob(workerId: string, jobType: string): Promise<ProcessingJobRow | null>;

  /** Update the heartbeat timestamp so the job is not recovered as abandoned. */
  heartbeat(jobId: string, workerId: string): Promise<void>;

  /** Atomically replace all pages and chunks and mark the job completed. */
  persistExtraction(input: PersistExtractionInput): Promise<PersistExtractionResult>;

  /** Mark the job permanently failed. */
  failJob(jobId: string, workerId: string, error: FailInput): Promise<void>;

  /** Schedule a retry attempt with bounded exponential backoff. */
  scheduleRetry(jobId: string, workerId: string, attempt: number, error: RetryInput): Promise<void>;

  /** Recover jobs with stale heartbeats: schedule retries or permanently fail. */
  recoverAbandonedJobs(heartbeatThresholdMinutes: number, workerId: string): Promise<number>;

  /** Load a processing job by id. */
  getJobById(jobId: string, organizationId: string): Promise<ProcessingJobRow | null>;

  /** Load a document by id, verifying organization ownership. */
  getDocumentById(documentId: string, organizationId: string): Promise<DocumentRow | null>;

  /** Download the document source file from storage. Returns a Buffer. */
  downloadFile(storagePath: string): Promise<Buffer>;

  /** Update document processing status independently of extraction persistence. */
  updateDocumentStatus(documentId: string, status: string): Promise<void>;

  /** Write one or more audit events. */
  writeAudit(records: ProcessingAuditRecord[]): Promise<void>;
}
