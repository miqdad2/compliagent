/**
 * Shared project-action state resolver.
 *
 * Pure logic — no IO. Takes the current document + review state and returns
 * the canonical action state plus the recommended primary action.
 * Used in the project header, overview tab, review tab, side panel, and
 * project list so that state logic is never duplicated in multiple components.
 */

export type AutomatedReviewActionState =
  | "documents_missing"          // no spec OR no submission doc uploaded yet
  | "documents_ready_to_process" // both exist but neither is completed
  | "documents_processing"       // at least one doc is actively being processed
  | "documents_failed"           // one or more docs failed, required docs not complete
  | "ready_to_review"            // all required docs completed, no review yet
  | "review_running"             // review is draft or running
  | "review_requires_attention"  // review needs human verification
  | "review_approved"            // review is approved
  | "report_ready";              // (reserved for future report-generation phase)

export type AutomatedReviewPrimaryAction =
  | { type: "upload_documents"; label: string }
  | { type: "run_review";       label: string }
  | { type: "view_progress";    label: string; reviewId: string }
  | { type: "review_findings";  label: string; reviewId: string }
  | { type: "view_approved";    label: string; reviewId: string }
  | { type: "none" };

export type AutomatedReviewActionInput = {
  /** True when at least one spec-role document has been uploaded (any status). */
  hasSpec: boolean;
  /** True when at least one submission-role document has been uploaded (any status). */
  hasSubmission: boolean;
  /** True when at least one document is currently queued/claimed/running/retry_wait. */
  isAnyDocumentProcessing: boolean;
  /** True when at least one document has failed and the required docs are not all completed. */
  hasAnyFailedDocuments: boolean;
  /** True when both a completed spec-role doc and a completed submission-role doc exist. */
  canRunReview: boolean;
  /** Most recent review for this project, or null if none exists. */
  latestReview: { id: string; status: string } | null;
};

export type AutomatedReviewActionResult = {
  state:  AutomatedReviewActionState;
  action: AutomatedReviewPrimaryAction;
};

/**
 * Derive the canonical project action state and primary action from the current
 * document and review state.
 *
 * Priority order (highest first):
 *   1. Existing review state (approved → requires_attention → running/draft)
 *   2. Document state (missing → processing → failed → ready → not-yet-processed)
 */
export function resolveAutomatedReviewAction(
  input: AutomatedReviewActionInput
): AutomatedReviewActionResult {
  const {
    hasSpec, hasSubmission,
    isAnyDocumentProcessing, hasAnyFailedDocuments, canRunReview,
    latestReview
  } = input;

  // ── Review states take highest priority ───────────────────────────────────

  if (latestReview) {
    if (latestReview.status === "approved") {
      return {
        state:  "review_approved",
        action: { type: "view_approved", label: "View approved review", reviewId: latestReview.id }
      };
    }
    if (latestReview.status === "awaiting_human_review") {
      return {
        state:  "review_requires_attention",
        action: { type: "review_findings", label: "Review flagged findings", reviewId: latestReview.id }
      };
    }
    if (latestReview.status === "draft" || latestReview.status === "running") {
      return {
        state:  "review_running",
        action: { type: "view_progress", label: "View review progress", reviewId: latestReview.id }
      };
    }
  }

  // ── Document states ───────────────────────────────────────────────────────

  if (!hasSpec || !hasSubmission) {
    return {
      state:  "documents_missing",
      action: { type: "upload_documents", label: "Upload documents" }
    };
  }

  if (isAnyDocumentProcessing) {
    return {
      state:  "documents_processing",
      action: { type: "run_review", label: "Run automated review" }
    };
  }

  if (hasAnyFailedDocuments && !canRunReview) {
    return {
      state:  "documents_failed",
      action: { type: "run_review", label: "Retry and run review" }
    };
  }

  if (canRunReview) {
    return {
      state:  "ready_to_review",
      action: { type: "run_review", label: "Run automated review" }
    };
  }

  // Both doc types exist but are not yet processed and not currently processing.
  return {
    state:  "documents_ready_to_process",
    action: { type: "run_review", label: "Process and run review" }
  };
}
