/**
 * Canonical document-processing status resolution.
 *
 * The `documents.processing_status` column can become stale when:
 *   - a new processing job is enqueued after a prior completed job;
 *   - the worker completes but the document row is not atomically updated;
 *   - multiple historical jobs exist in undefined order.
 *
 * This resolver always picks the LATEST processing job (by created_at DESC,
 * updated_at DESC, id DESC) and derives the canonical status from that job.
 * If no job exists, it falls back to the document-row status.
 *
 * Rules:
 *   1. Latest active job (queued / claimed / running / retry_wait) wins.
 *   2. Latest terminal result (completed / failed) from the most recent job wins.
 *   3. Persisted documents.processing_status is the fallback when no jobs exist.
 *
 * A document whose latest job is "completed" and has page_count > 0 is
 * considered fully processed, regardless of the documents.processing_status column.
 */

import type { Database } from "@/types/database";

export type ProcessingJobRow = Database["public"]["Tables"]["processing_jobs"]["Row"];
export type DocumentRow     = Database["public"]["Tables"]["documents"]["Row"];

/** Slim job shape: only the fields needed for status resolution. */
export type LatestJobSnapshot = {
  id:                 string;
  status:             string;
  progress:           number;
  last_error_code:    string | null;
  safe_error_message: string | null;
  created_at:         string;
  updated_at:         string;
};

/** Full document row with the resolved latest job attached. */
export type DocumentWithLatestJob = DocumentRow & {
  latestJob: LatestJobSnapshot | null;
};

export type ResolvedDocumentStatus =
  | "uploaded"
  | "queued"
  | "claimed"
  | "running"
  | "retry_wait"
  | "completed"
  | "failed";

export type ResolvedDocumentProcessingState = {
  /** Canonical status derived from the latest job, or the document row as fallback. */
  status:               ResolvedDocumentStatus;
  /** 0–100 from the latest job, or null when no job is available. */
  progress:             number | null;
  /** ID of the latest processing job, or null if none. */
  latestJobId:          string | null;
  /** ISO timestamp of the latest job creation, or null if none. */
  latestJobCreatedAt:   string | null;
  /** Safe error code from the latest failed job. */
  errorCode:            string | null;
  /** Safe human-readable error message. Never contains credentials. */
  safeErrorMessage:     string | null;
  /** True when a worker currently holds this job (queued/claimed/running/retry_wait). */
  isActivelyProcessing: boolean;
  /** True when the document can be submitted for a new processing job. */
  canProcess:           boolean;
  /** True when the document was previously completed and can be reprocessed. */
  canReprocess:         boolean;
};

const ACTIVE_STATUSES  = new Set(["queued", "claimed", "running", "retry_wait"]);
const VALID_STATUSES   = new Set<ResolvedDocumentStatus>([
  "uploaded", "queued", "claimed", "running", "retry_wait", "completed", "failed"
]);

function toResolvedStatus(raw: string): ResolvedDocumentStatus {
  if (VALID_STATUSES.has(raw as ResolvedDocumentStatus)) {
    return raw as ResolvedDocumentStatus;
  }
  // Legacy / unexpected values map to "uploaded" so the UI offers a Process action.
  return "uploaded";
}

/**
 * Derive the canonical processing state for a single document.
 *
 * @param doc The document row, optionally with the latest job already attached.
 */
export function resolveDocumentStatus(doc: DocumentWithLatestJob): ResolvedDocumentProcessingState {
  const job = doc.latestJob;

  if (!job) {
    // No processing history.
    // If the document row claims an active status (queued/running etc.) but there is no
    // backing job, the status is stale — treat it as "uploaded" so the user can Process.
    const raw = toResolvedStatus(doc.processing_status ?? "uploaded");
    const status = ACTIVE_STATUSES.has(raw) ? "uploaded" : raw;
    return {
      status,
      progress:             null,
      latestJobId:          null,
      latestJobCreatedAt:   null,
      errorCode:            null,
      safeErrorMessage:     null,
      isActivelyProcessing: false,
      canProcess:           status !== "completed",
      canReprocess:         status === "completed"
    };
  }

  const status          = toResolvedStatus(job.status);
  const isActive        = ACTIVE_STATUSES.has(status);
  const isCompleted     = status === "completed";

  return {
    status,
    progress:             job.progress,
    latestJobId:          job.id,
    latestJobCreatedAt:   job.created_at,
    errorCode:            job.last_error_code,
    safeErrorMessage:     job.safe_error_message,
    isActivelyProcessing: isActive,
    canProcess:           !isActive && !isCompleted,
    canReprocess:         isCompleted
  };
}

/** Job row shape returned by the project-documents query. */
export type ProjectJobRow = LatestJobSnapshot & { document_id: string };

/**
 * Given a flat list of all processing jobs for a project (in any order),
 * return a Map<documentId, LatestJobSnapshot> containing only the single
 * most-recent job per document.
 *
 * Jobs are compared by created_at DESC, updated_at DESC, id DESC (lexicographic).
 */
export function buildLatestJobMap(jobs: ProjectJobRow[]): Map<string, LatestJobSnapshot> {
  const result = new Map<string, LatestJobSnapshot>();
  for (const job of jobs) {
    const docId = job.document_id;
    if (!docId) continue;
    const prev = result.get(docId);
    if (!prev || isNewerJob(job, prev)) {
      // Store without document_id to keep the snapshot shape clean.
      const { document_id: _d, ...snapshot } = job;
      result.set(docId, snapshot);
    }
  }
  return result;
}

function isNewerJob(a: { created_at: string; updated_at: string; id: string }, b: { created_at: string; updated_at: string; id: string }): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at;
  return a.id > b.id;
}

// ── Status display helpers ────────────────────────────────────────────────────

/** Human-readable label for each resolved status. */
export const RESOLVED_STATUS_LABEL: Record<ResolvedDocumentStatus, string> = {
  uploaded:    "Ready to process",
  queued:      "Queued",
  claimed:     "Starting",
  running:     "Processing",
  retry_wait:  "Retry scheduled",
  completed:   "Completed",
  failed:      "Failed"
};

/** Badge tone for each resolved status. */
export const RESOLVED_STATUS_TONE: Record<
  ResolvedDocumentStatus,
  "green" | "amber" | "blue" | "red" | "gray"
> = {
  uploaded:   "gray",
  queued:     "gray",
  claimed:    "blue",
  running:    "blue",
  retry_wait: "amber",
  completed:  "green",
  failed:     "red"
};

/** Action button label for each resolved status. */
export function getActionLabel(state: ResolvedDocumentProcessingState): string | null {
  if (state.isActivelyProcessing) return null;
  if (state.canReprocess)         return "Reprocess";
  if (state.status === "failed")  return "Retry";
  if (state.canProcess)           return "Process";
  return null;
}

// ── Specification / submission role families ──────────────────────────────────

export const SPECIFICATION_ROLES = new Set([
  "specification",
  "main_specification",
  "reference_standard",
  "compliance_statement"
]);

export const SUBMISSION_ROLES = new Set([
  "contractor_submission",
  "proposed_product",
  "product_datasheet",
  "certificate",
  "drawing",
  "calculation",
  "method_statement",
  "test_report",
  "supporting_evidence",
  "correspondence",
  "manual",
  "other"
]);

export function isSpecificationRole(role: string): boolean {
  return SPECIFICATION_ROLES.has(role);
}

export function isSubmissionRole(role: string): boolean {
  return SUBMISSION_ROLES.has(role);
}
