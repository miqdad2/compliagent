import type {
  ReviewRow,
  FindingRow,
  RequirementRow,
  ChunkRow,
  EvidenceRegionRow,
  ReviewScope,
  FindingUpsertInput,
  ReviewAuditRecord,
  ReviewStatus
} from "./types";
import type { ReviewPersistenceGateway } from "./gateway";

/** In-memory implementation for unit tests. No database dependency. */
export class MemoryReviewGateway implements ReviewPersistenceGateway {
  private reviews = new Map<string, ReviewRow>();
  private findings = new Map<string, FindingRow>();
  private requirements: RequirementRow[] = [];
  private chunks: ChunkRow[] = [];
  private evidenceRegions: EvidenceRegionRow[] = [];
  readonly auditLog: ReviewAuditRecord[] = [];

  /** Seed helpers for tests. */
  seedReview(row: ReviewRow): void {
    this.reviews.set(row.id, row);
  }

  seedRequirements(rows: RequirementRow[]): void {
    this.requirements.push(...rows);
  }

  seedChunks(rows: ChunkRow[]): void {
    this.chunks.push(...rows);
  }

  seedEvidenceRegions(rows: EvidenceRegionRow[]): void {
    this.evidenceRegions.push(...rows);
  }

  getFinding(findingId: string): FindingRow | undefined {
    return this.findings.get(findingId);
  }

  getReviewRow(reviewId: string): ReviewRow | undefined {
    return this.reviews.get(reviewId);
  }

  // ── Interface implementation ────────────────────────────────────────────────

  async getReview(reviewId: string, organizationId: string): Promise<ReviewRow | null> {
    const row = this.reviews.get(reviewId);
    if (!row) return null;
    if (row.organization_id !== null && row.organization_id !== organizationId) return null;
    return row;
  }

  async beginReview(
    organizationId: string,
    projectId: string,
    reviewId: string,
    reviewVersion: number,
    sourceHash: string,
    extractionVersion: string,
    promptVersion: string
  ): Promise<ReviewScope> {
    const row = this.reviews.get(reviewId);
    if (!row) throw new Error("REVIEW_NOT_FOUND");
    if (row.organization_id !== null && row.organization_id !== organizationId) {
      throw new Error("ORGANIZATION_ACCESS_DENIED");
    }
    if (!["draft", "ready", "failed"].includes(row.status)) {
      throw new Error(`REVIEW_STATE_CONFLICT:${row.status}`);
    }
    const updated: ReviewRow = {
      ...row,
      organization_id: organizationId,
      status: "running",
      review_version: reviewVersion,
      source_hash: sourceHash,
      extraction_version: extractionVersion,
      prompt_version: promptVersion,
      started_at: new Date().toISOString(),
      completed_at: null,
      failed_at: null,
      updated_at: new Date().toISOString()
    };
    this.reviews.set(reviewId, updated);
    return {
      reviewId,
      organizationId,
      projectId,
      status: "running",
      reviewVersion,
      sourceHash,
      extractionVersion,
      promptVersion
    };
  }

  async completeReviewToHumanReview(
    organizationId: string,
    reviewId: string,
    _findingCount: number,
    _conditionCount: number
  ): Promise<void> {
    const row = this.reviews.get(reviewId);
    if (!row) throw new Error("REVIEW_NOT_FOUND");
    if (row.status !== "running") throw new Error(`REVIEW_STATE_CONFLICT:${row.status}`);
    this.reviews.set(reviewId, {
      ...row,
      status: "awaiting_human_review",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  async failReview(
    _organizationId: string,
    reviewId: string,
    _errorCode: string,
    _safeMessage: string
  ): Promise<void> {
    const row = this.reviews.get(reviewId);
    if (!row) throw new Error("REVIEW_NOT_FOUND");
    this.reviews.set(reviewId, {
      ...row,
      status: "failed",
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  async upsertFinding(input: FindingUpsertInput): Promise<string> {
    // Check for existing finding by requirement+review.
    for (const [id, f] of this.findings) {
      if (f.review_id === input.reviewId && f.requirement_id === input.requirementId) {
        return id;
      }
    }
    const id = `finding-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    this.findings.set(id, {
      id,
      organization_id: input.organizationId,
      review_id: input.reviewId,
      project_id: input.projectId,
      requirement_id: input.requirementId,
      evidence_id: null,
      clause_number: input.clauseNumber,
      sub_clause_number: input.subClauseNumber,
      requirement_text: input.requirementText,
      evidence_text: null,
      status: input.status as FindingRow["status"],
      ai_derived_status: null,
      deterministic_derived_status: null,
      weightage_score: input.weightageScore,
      confidence_score: input.confidenceScore,
      reasoning: input.reasoning,
      missing_information: null,
      contractor_action: null,
      risk_level: input.riskLevel as FindingRow["risk_level"],
      human_override_status: null,
      human_comment: null,
      reviewer_comment: null,
      reviewed_by: null,
      reviewed_at: null,
      annotation_ready: false,
      created_at: now,
      updated_at: now
    });
    return id;
  }

  async updateFindingStatus(
    findingId: string,
    _organizationId: string,
    deterministicStatus: string,
    finalStatus: string,
    reasoning: string
  ): Promise<void> {
    const row = this.findings.get(findingId);
    if (!row) return;
    this.findings.set(findingId, {
      ...row,
      deterministic_derived_status: deterministicStatus as FindingRow["deterministic_derived_status"],
      status: finalStatus as FindingRow["status"],
      reasoning,
      updated_at: new Date().toISOString()
    });
  }

  async listRequirementsForProject(projectId: string, _organizationId: string): Promise<RequirementRow[]> {
    return this.requirements.filter((r) => r.project_id === projectId);
  }

  async listChunksForDocuments(documentIds: string[], projectId: string): Promise<ChunkRow[]> {
    return this.chunks.filter((c) => documentIds.includes(c.document_id) && c.project_id === projectId);
  }

  async listEvidenceRegionsForDocuments(
    documentIds: string[],
    _organizationId: string,
    projectId: string
  ): Promise<EvidenceRegionRow[]> {
    return this.evidenceRegions.filter(
      (r) => documentIds.includes(r.document_id) && r.project_id === projectId
    );
  }

  async listFindingsForReview(reviewId: string, _organizationId: string): Promise<FindingRow[]> {
    return [...this.findings.values()].filter((f) => f.review_id === reviewId);
  }

  private projectDocuments: Array<{ id: string; document_role: string; processing_status: string }> = [];

  seedProjectDocuments(docs: Array<{ id: string; document_role: string; processing_status: string }>): void {
    this.projectDocuments.push(...docs);
  }

  async listProjectDocuments(
    _projectId: string,
    _organizationId: string
  ): Promise<Array<{ id: string; document_role: string; processing_status: string }>> {
    return this.projectDocuments;
  }

  async writeAudit(records: ReviewAuditRecord[]): Promise<void> {
    this.auditLog.push(...records);
  }
}

/** Build a minimal ReviewRow for test seeding. */
export function makeTestReviewRow(overrides: Partial<ReviewRow> & { id: string; project_id: string }): ReviewRow {
  const now = new Date().toISOString();
  return {
    organization_id: "org-1",
    title: "Test Review",
    review_scope: null,
    status: "draft" as ReviewStatus,
    ai_model: null,
    review_version: 1,
    source_hash: null,
    extraction_version: null,
    prompt_version: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    annotation_ready: false,
    annotation_ready_at: null,
    annotation_ready_by: null,
    annotation_blockers: null,
    created_by: "user-1",
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

/** Build a minimal RequirementRow for test seeding. */
export function makeTestRequirementRow(
  overrides: Partial<RequirementRow> & { id: string; project_id: string; source_document_id: string }
): RequirementRow {
  const now = new Date().toISOString();
  return {
    organization_id: null,
    review_id: null,
    page_number: 1,
    clause_number: null,
    sub_clause_number: null,
    section_heading: null,
    requirement_text: "Test requirement",
    normalized_text: null,
    requirement_type: null,
    requirement_state: "confirmed",
    discipline: null,
    mandatory_level: "mandatory",
    numeric_value: null,
    unit: null,
    standard_reference: null,
    acceptance_criteria: null,
    extraction_confidence: 90,
    discovery_confidence: null,
    refinement_confidence: null,
    ai_run_id: null,
    prompt_version: null,
    human_review_required: false,
    human_review_reasons: null,
    is_active: true,
    superseded_at: null,
    superseded_reason: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}
