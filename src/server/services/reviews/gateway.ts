import type {
  ReviewRow,
  FindingRow,
  RequirementRow,
  ChunkRow,
  EvidenceRegionRow,
  ReviewScope,
  FindingUpsertInput,
  ReviewAuditRecord
} from "./types";

export interface ReviewPersistenceGateway {
  /** Load the full review row; returns null if not found or not in org scope. */
  getReview(reviewId: string, organizationId: string): Promise<ReviewRow | null>;

  /** Atomically transition a review to running, recording idempotency fields. */
  beginReview(
    organizationId: string,
    projectId: string,
    reviewId: string,
    reviewVersion: number,
    sourceHash: string,
    extractionVersion: string,
    promptVersion: string
  ): Promise<ReviewScope>;

  /** Atomically transition a running review to awaiting_human_review. */
  completeReviewToHumanReview(
    organizationId: string,
    reviewId: string,
    findingCount: number,
    conditionCount: number
  ): Promise<void>;

  /** Atomically mark a running review as failed. */
  failReview(
    organizationId: string,
    reviewId: string,
    errorCode: string,
    safeMessage: string
  ): Promise<void>;

  /** Find or create a compliance finding row for a given requirement+review.
   *  Idempotent: returns the existing finding id if one already exists. */
  upsertFinding(input: FindingUpsertInput): Promise<string>;

  /** Update the derived status on an existing finding. */
  updateFindingStatus(
    findingId: string,
    organizationId: string,
    deterministicStatus: string,
    finalStatus: string,
    reasoning: string
  ): Promise<void>;

  /** List requirements for a project, joined with their source document role. */
  listRequirementsForProject(
    projectId: string,
    organizationId: string
  ): Promise<RequirementRow[]>;

  /** Load processed document chunks for a set of document IDs. */
  listChunksForDocuments(
    documentIds: string[],
    projectId: string
  ): Promise<ChunkRow[]>;

  /** Load evidence regions for a project scoped to specific document IDs. */
  listEvidenceRegionsForDocuments(
    documentIds: string[],
    organizationId: string,
    projectId: string
  ): Promise<EvidenceRegionRow[]>;

  /** List finding rows for a review. */
  listFindingsForReview(
    reviewId: string,
    organizationId: string
  ): Promise<FindingRow[]>;

  /** List all documents for a project with their role and processing status. */
  listProjectDocuments(
    projectId: string,
    organizationId: string
  ): Promise<Array<{ id: string; document_role: string; processing_status: string }>>;

  /** Write audit records. */
  writeAudit(records: ReviewAuditRecord[]): Promise<void>;
}
