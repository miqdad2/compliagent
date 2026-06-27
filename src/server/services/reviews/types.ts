import type { Database } from "@/types/database";
import type { DocumentRole } from "@/types/domain";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievalResult, ComparisonResult, VerificationResult } from "@/lib/ai/schemas";
import type { ParentFindingDerivationResult } from "@/lib/compliance/condition-schemas";
import type { ConfidenceFlag } from "@/lib/ai/review-schemas";

export type { ConfidenceFlag };

// ── DB row aliases ────────────────────────────────────────────────────────────

export type ReviewRow = Database["public"]["Tables"]["compliance_reviews"]["Row"];
export type FindingRow = Database["public"]["Tables"]["compliance_findings"]["Row"];
export type RequirementRow = Database["public"]["Tables"]["extracted_requirements"]["Row"];
export type ChunkRow = Database["public"]["Tables"]["document_chunks"]["Row"];
export type DocumentPageRow = Database["public"]["Tables"]["document_pages"]["Row"];
export type EvidenceRegionRow = Database["public"]["Tables"]["evidence_regions"]["Row"];

// ── Execution mode ────────────────────────────────────────────────────────────

/** Controls which comparison and verification implementations the orchestrator uses. */
export type ExecutionMode = "deterministic" | "mock" | "controlled_live";

// ── Review lifecycle ──────────────────────────────────────────────────────────

export type ReviewStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "human_review_pending"
  | "awaiting_human_review"
  | "approved"
  | "cancelled"
  | "superseded";

export type ReviewLifecycleTransition = {
  reviewId: string;
  status: ReviewStatus;
  reviewVersion?: number;
};

// ── ServiceResult ─────────────────────────────────────────────────────────────

export type ReviewErrorCode =
  | "REVIEW_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "ORGANIZATION_ACCESS_DENIED"
  | "PROJECT_ACCESS_DENIED"
  | "REVIEW_STATE_CONFLICT"
  | "NO_PROCESSED_DOCUMENTS"
  | "NO_REQUIREMENTS_FOUND"
  | "CONDITION_DECOMPOSITION_FAILED"
  | "EVIDENCE_RETRIEVAL_FAILED"
  | "COMPARISON_FAILED"
  | "VERIFICATION_FAILED"
  | "PERSISTENCE_FAILED"
  | "IDEMPOTENT_SKIP"
  | "CONSENT_REQUIRED"
  | "UNSUPPORTED_DOCUMENT_FORMAT"
  | "TRANSACTION_FAILED";

export type ReviewServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: ReviewErrorCode; message: string; retryable?: boolean };

export function ok<T>(data: T): ReviewServiceResult<T> {
  return { ok: true, data };
}

export function fail<T>(
  errorCode: ReviewErrorCode,
  message: string,
  retryable?: boolean
): ReviewServiceResult<T> {
  return { ok: false, errorCode, message, retryable };
}

// ── Discovered requirement (lightweight) ─────────────────────────────────────

export type DiscoveredRequirement = {
  requirementId: string;
  projectId: string;
  sourceDocumentId: string;
  pageNumber: number;
  clauseNumber: string | null;
  subClauseNumber: string | null;
  requirementText: string;
  mandatoryLevel: string | null;
  extractionConfidence: number;
};

// ── Evidence retrieval ────────────────────────────────────────────────────────

export type EvidenceSufficiency =
  | "direct"
  | "partial"
  | "contradictory"
  | "contextual"
  | "irrelevant"
  | "unverified";

export type RetrievedEvidence = {
  conditionId: string;
  retrievalResults: RetrievalResult[];
  sufficiency: EvidenceSufficiency;
  primaryQuote: string | null;
  primaryRegionId: string | null;
};

// ── Condition evaluation result ───────────────────────────────────────────────

export type ConditionEvaluationDraft = {
  condition: RequirementConditionRow;
  retrieval: RetrievedEvidence;
  comparison: ComparisonResult;
  verification: VerificationResult;
  finalStatus: string;
  evidenceSummary: string | null;
  reasoning: string;
  contradictionReasoning: string | null;
  missingInformation: string | null;
  verificationFailureReason: string | null;
  contractorAction: string | null;
  confidenceScore: number;
  weightageScore: number;
  isHumanReviewRequired: boolean;
};

// ── Per-requirement finding draft ─────────────────────────────────────────────

export type FindingDraft = {
  requirementId: string;
  findingId: string;
  clauseNumber: string | null;
  subClauseNumber: string | null;
  requirementText: string;
  conditionEvaluations: ConditionEvaluationDraft[];
  parentDerivation: ParentFindingDerivationResult;
  finalStatus: string;
  confidenceScore: number;
  weightageScore: number;
  riskLevel: string;
  reasoning: string;
};

// ── Full review run inputs ────────────────────────────────────────────────────

export type RunControlledReviewInput = {
  organizationId:    string;
  projectId:         string;
  reviewId:          string;
  createdBy:         string;
  reviewVersion:     number;
  sourceHash:        string;
  extractionVersion: string;
  promptVersion:     string;
  executionMode:     ExecutionMode;
};

export type RunControlledReviewResult = {
  reviewId:         string;
  status:           ReviewStatus;
  executionMode:    ExecutionMode;
  findingCount:     number;
  conditionCount:   number;
  requirementCount: number;
  idempotentSkip:   boolean;
  aiRunCount:       number;
  humanReviewRequiredCount: number;
  flags:            ConfidenceFlag[];
};

// ── Document role checks ──────────────────────────────────────────────────────

export type DocumentRoleCheck = {
  documentId: string;
  role: DocumentRole;
  processingStatus: string;
  isSpecificationRole: boolean;
  isSubmissionRole: boolean;
};

// ── Gateway scope inputs ──────────────────────────────────────────────────────

export type ReviewScope = {
  reviewId: string;
  organizationId: string;
  projectId: string;
  status: ReviewStatus;
  reviewVersion: number;
  sourceHash: string | null;
  extractionVersion: string | null;
  promptVersion: string | null;
};

export type FindingUpsertInput = {
  organizationId: string;
  projectId: string;
  reviewId: string;
  requirementId: string;
  clauseNumber: string | null;
  subClauseNumber: string | null;
  requirementText: string;
  status: string;
  weightageScore: number;
  confidenceScore: number;
  reasoning: string;
  riskLevel: string;
  createdBy: string;
};

export type ReviewAuditRecord = {
  organizationId: string;
  projectId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
};
