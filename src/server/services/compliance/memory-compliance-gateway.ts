/**
 * In-memory CompliancePersistenceGateway for unit tests.
 * No database dependency. Exported so it can be shared across test files.
 */
import type {
  ComplianceAuditRecord,
  CompliancePersistenceGateway,
  ConditionEvaluationInsert,
  ConditionEvaluationRow,
  ConditionEvaluationUpdate,
  ConditionEvidenceRegionInsert,
  ConditionEvidenceRegionRow,
  EvidenceRegionScope,
  FindingRow,
  FindingStatusUpdate,
  RequirementConditionInsert,
  RequirementConditionRow,
  RequirementScope,
  TransactionalPersistInput,
  TransactionalPersistResult
} from "./gateway";
import { HumanApprovalProtectedError } from "./supabase-compliance-gateway";

const TIMESTAMP = "2026-06-25T00:00:00.000Z";

export class MemoryComplianceGateway implements CompliancePersistenceGateway {
  requirementScopes: Record<string, RequirementScope> = {};
  conditions: RequirementConditionRow[] = [];
  evaluations: ConditionEvaluationRow[] = [];
  evidenceLinks: ConditionEvidenceRegionRow[] = [];
  evidenceRegions: Record<string, EvidenceRegionScope> = {};
  findings: FindingRow[] = [];
  audits: ComplianceAuditRecord[] = [];
  transactionShouldFail = false;
  transactionShouldFailWithHumanProtection = false;

  private _nextId = 1;
  private newId() {
    return `mem-${this._nextId++}`;
  }

  // ── Seeding helpers ───────────────────────────────────────────────────────

  seedRequirementScope(scope: RequirementScope): void {
    this.requirementScopes[scope.id] = scope;
  }

  seedCondition(row: RequirementConditionRow): void {
    this.conditions.push(row);
  }

  seedFinding(row: FindingRow): void {
    this.findings.push(row);
  }

  seedEvidenceRegion(scope: EvidenceRegionScope): void {
    this.evidenceRegions[scope.id] = scope;
  }

  // ── Interface implementation ──────────────────────────────────────────────

  async getRequirementScope(requirementId: string, projectId: string): Promise<RequirementScope | null> {
    const scope = this.requirementScopes[requirementId];
    return scope?.projectId === projectId ? scope : null;
  }

  async listActiveConditionsByRequirement(requirementId: string): Promise<RequirementConditionRow[]> {
    return this.conditions.filter((c) => c.requirement_id === requirementId && c.is_active);
  }

  async listActiveConditionsByProject(projectId: string, organizationId: string): Promise<RequirementConditionRow[]> {
    return this.conditions.filter(
      (c) => c.project_id === projectId && c.organization_id === organizationId && c.is_active
    );
  }

  async getCondition(conditionId: string, organizationId: string): Promise<RequirementConditionRow | null> {
    return this.conditions.find((c) => c.id === conditionId && c.organization_id === organizationId) ?? null;
  }

  async insertConditions(conditions: RequirementConditionInsert[]): Promise<RequirementConditionRow[]> {
    const rows: RequirementConditionRow[] = conditions.map((c) => ({
      id: this.newId(),
      organization_id: c.organization_id,
      project_id: c.project_id,
      requirement_id: c.requirement_id,
      condition_order: c.condition_order,
      condition_key: c.condition_key,
      condition_type: c.condition_type,
      subject: c.subject,
      attribute: c.attribute,
      operator: c.operator,
      expected_text: c.expected_text ?? null,
      expected_numeric_value: c.expected_numeric_value ?? null,
      expected_min_value: c.expected_min_value ?? null,
      expected_max_value: c.expected_max_value ?? null,
      expected_unit: c.expected_unit ?? null,
      is_mandatory: c.is_mandatory ?? true,
      source_text: c.source_text,
      extraction_confidence: c.extraction_confidence,
      is_active: c.is_active ?? true,
      is_human_confirmed: c.is_human_confirmed ?? false,
      superseded_at: null,
      superseded_reason: null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP
    }));
    this.conditions.push(...rows);
    return rows;
  }

  async supersedConditions(conditionIds: string[], reason: string): Promise<void> {
    for (const id of conditionIds) {
      const c = this.conditions.find((x) => x.id === id);
      if (c) { c.is_active = false; c.superseded_at = TIMESTAMP; c.superseded_reason = reason; }
    }
  }

  async markConditionHumanConfirmed(conditionId: string, confirmed: boolean): Promise<void> {
    const c = this.conditions.find((x) => x.id === conditionId);
    if (c) c.is_human_confirmed = confirmed;
  }

  async getActiveEvaluationByCondition(reviewId: string, conditionId: string): Promise<ConditionEvaluationRow | null> {
    return (
      this.evaluations.find(
        (e) => e.review_id === reviewId && e.requirement_condition_id === conditionId && e.is_active
      ) ?? null
    );
  }

  async listActiveEvaluationsByFinding(findingId: string, organizationId: string): Promise<ConditionEvaluationRow[]> {
    return this.evaluations.filter((e) => e.finding_id === findingId && e.organization_id === organizationId && e.is_active);
  }

  async listActiveEvaluationsByReview(reviewId: string, organizationId: string): Promise<ConditionEvaluationRow[]> {
    return this.evaluations.filter((e) => e.review_id === reviewId && e.organization_id === organizationId && e.is_active);
  }

  async getEvaluationWithCondition(
    evaluationId: string,
    organizationId: string
  ): Promise<(ConditionEvaluationRow & { condition: RequirementConditionRow | null }) | null> {
    const evaluation = this.evaluations.find((e) => e.id === evaluationId && e.organization_id === organizationId);
    if (!evaluation) return null;
    const condition = this.conditions.find((c) => c.id === evaluation.requirement_condition_id) ?? null;
    return { ...evaluation, condition };
  }

  async insertEvaluation(input: ConditionEvaluationInsert): Promise<ConditionEvaluationRow> {
    const row: ConditionEvaluationRow = {
      id: this.newId(),
      organization_id: input.organization_id,
      project_id: input.project_id,
      review_id: input.review_id,
      finding_id: input.finding_id,
      requirement_id: input.requirement_id,
      requirement_condition_id: input.requirement_condition_id,
      status: input.status,
      evidence_summary: input.evidence_summary ?? null,
      reasoning: input.reasoning,
      contradiction_reasoning: input.contradiction_reasoning ?? null,
      missing_information: input.missing_information ?? null,
      verification_failure_reason: input.verification_failure_reason ?? null,
      contractor_action: input.contractor_action ?? null,
      confidence_score: input.confidence_score,
      weightage_score: input.weightage_score,
      is_human_review_required: input.is_human_review_required ?? true,
      human_status: input.human_status ?? null,
      human_comment: input.human_comment ?? null,
      reviewed_by: input.reviewed_by ?? null,
      reviewed_at: input.reviewed_at ?? null,
      is_active: input.is_active ?? true,
      revision_number: input.revision_number ?? 1,
      superseded_at: null,
      superseded_reason: null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP
    };
    this.evaluations.push(row);
    return row;
  }

  async updateEvaluation(id: string, organizationId: string, update: ConditionEvaluationUpdate): Promise<ConditionEvaluationRow | null> {
    const e = this.evaluations.find((x) => x.id === id && x.organization_id === organizationId);
    if (!e) return null;
    Object.assign(e, update);
    return e;
  }

  async supersedEvaluation(evaluationId: string, reason: string): Promise<void> {
    const e = this.evaluations.find((x) => x.id === evaluationId);
    if (e) { e.is_active = false; e.superseded_at = TIMESTAMP; e.superseded_reason = reason; }
  }

  async applyHumanReviewStatus(
    evaluationId: string,
    organizationId: string,
    humanStatus: string,
    humanComment: string | null,
    reviewerId: string,
    reviewedAt: string
  ): Promise<ConditionEvaluationRow | null> {
    const e = this.evaluations.find((x) => x.id === evaluationId && x.organization_id === organizationId);
    if (!e) return null;
    e.human_status = humanStatus as ConditionEvaluationRow["human_status"];
    e.human_comment = humanComment;
    e.reviewed_by = reviewerId;
    e.reviewed_at = reviewedAt;
    return e;
  }

  async getEvidenceRegionScope(regionId: string): Promise<EvidenceRegionScope | null> {
    return this.evidenceRegions[regionId] ?? null;
  }

  async listEvidenceLinksForEvaluation(evaluationId: string): Promise<ConditionEvidenceRegionRow[]> {
    return this.evidenceLinks.filter((l) => l.condition_evaluation_id === evaluationId);
  }

  async listEvaluationsForRegion(regionId: string, organizationId: string): Promise<ConditionEvidenceRegionRow[]> {
    return this.evidenceLinks.filter(
      (l) => l.evidence_region_id === regionId && l.organization_id === organizationId
    );
  }

  async insertEvidenceLink(link: ConditionEvidenceRegionInsert): Promise<ConditionEvidenceRegionRow> {
    const row: ConditionEvidenceRegionRow = {
      id: this.newId(),
      condition_evaluation_id: link.condition_evaluation_id,
      evidence_region_id: link.evidence_region_id ?? null,
      organization_id: link.organization_id,
      project_id: link.project_id,
      relationship_type: link.relationship_type,
      created_at: TIMESTAMP
    };
    this.evidenceLinks.push(row);
    return row;
  }

  async deleteEvidenceLink(linkId: string): Promise<void> {
    const idx = this.evidenceLinks.findIndex((l) => l.id === linkId);
    if (idx >= 0) this.evidenceLinks.splice(idx, 1);
  }

  async getFinding(findingId: string, projectId: string): Promise<FindingRow | null> {
    const found = this.findings.find((f) => f.id === findingId && f.project_id === projectId);
    if (found) return found;
    // When used with the review orchestrator, findings are created via a separate
    // review gateway. Return a minimal stub so the compliance pipeline can proceed;
    // persistEvaluationAndRefreshParent will persist the real status update.
    if (this._stubMissingFindings) {
      const stub: FindingRow = {
        id: findingId,
        organization_id: null,
        review_id: "",
        project_id: projectId,
        requirement_id: null,
        evidence_id: null,
        clause_number: null, sub_clause_number: null,
        requirement_text: "",
        evidence_text: null,
        status: "not_proven",
        ai_derived_status: null,
        deterministic_derived_status: null,
        weightage_score: 1, confidence_score: 0,
        reasoning: "",
        missing_information: null, contractor_action: null,
        risk_level: "high",
        human_override_status: null, human_comment: null,
        reviewer_comment: null,
        reviewed_by: null, reviewed_at: null,
        annotation_ready: false,
        created_at: TIMESTAMP, updated_at: TIMESTAMP
      };
      this.findings.push(stub);
      return stub;
    }
    return null;
  }

  /** Enable auto-stub for findings not pre-seeded (used by orchestrator tests). */
  _stubMissingFindings = false;

  enableFindingStubs(): void {
    this._stubMissingFindings = true;
  }

  async updateFindingDerivedStatus(findingId: string, projectId: string, update: FindingStatusUpdate): Promise<void> {
    const f = this.findings.find((x) => x.id === findingId && x.project_id === projectId);
    if (f) {
      f.deterministic_derived_status = update.deterministicDerivedStatus as FindingRow["status"];
      f.status = update.finalStatus as FindingRow["status"];
      f.reasoning = update.reasoning;
    }
  }

  async persistEvaluationAndRefreshParent(input: TransactionalPersistInput): Promise<TransactionalPersistResult> {
    if (this.transactionShouldFail) throw new Error("TRANSACTION_FAILED: Simulated database error.");
    if (this.transactionShouldFailWithHumanProtection) throw new HumanApprovalProtectedError();

    const existingActive = this.evaluations.find(
      (e) =>
        e.review_id === input.reviewId &&
        e.requirement_condition_id === input.requirementConditionId &&
        e.is_active
    );
    if (existingActive?.human_status != null) throw new HumanApprovalProtectedError();

    if (existingActive) {
      existingActive.is_active = false;
      existingActive.superseded_at = TIMESTAMP;
      existingActive.superseded_reason = "reprocessed";
    }

    const revision = (existingActive?.revision_number ?? 0) + 1;
    const newEval: ConditionEvaluationRow = {
      id: this.newId(),
      organization_id: input.organizationId,
      project_id: input.projectId,
      review_id: input.reviewId,
      finding_id: input.findingId,
      requirement_id: input.requirementId,
      requirement_condition_id: input.requirementConditionId,
      status: input.status as ConditionEvaluationRow["status"],
      evidence_summary: input.evidenceSummary,
      reasoning: input.reasoning,
      contradiction_reasoning: input.contradictionReasoning,
      missing_information: input.missingInformation,
      verification_failure_reason: input.verificationFailureReason,
      contractor_action: input.contractorAction,
      confidence_score: input.confidenceScore,
      weightage_score: input.weightageScore,
      is_human_review_required: input.isHumanReviewRequired,
      human_status: null, human_comment: null, reviewed_by: null, reviewed_at: null,
      is_active: true,
      revision_number: revision,
      superseded_at: null, superseded_reason: null,
      created_at: TIMESTAMP, updated_at: TIMESTAMP
    };
    this.evaluations.push(newEval);

    for (const link of input.evidenceLinks) {
      this.evidenceLinks.push({
        id: this.newId(),
        condition_evaluation_id: newEval.id,
        evidence_region_id: link.regionId,
        organization_id: input.organizationId,
        project_id: input.projectId,
        relationship_type: link.relationshipType as ConditionEvidenceRegionRow["relationship_type"],
        created_at: TIMESTAMP
      });
    }

    // When the finding doesn't exist yet (it was created by the review gateway,
    // not the compliance gateway), create a stub so persistence doesn't fail.
    let finding = this.findings.find((f) => f.id === input.findingId);
    if (!finding) {
      finding = {
        id: input.findingId,
        organization_id: input.organizationId,
        review_id: input.reviewId,
        project_id: input.projectId,
        requirement_id: input.requirementId,
        evidence_id: null,
        clause_number: null, sub_clause_number: null,
        requirement_text: "",
        evidence_text: null,
        status: "not_proven",
        ai_derived_status: null,
        deterministic_derived_status: null,
        weightage_score: 1, confidence_score: 0,
        reasoning: "", missing_information: null,
        contractor_action: null, risk_level: "high",
        human_override_status: null, human_comment: null,
        reviewer_comment: null, reviewed_by: null, reviewed_at: null,
        annotation_ready: false,
        created_at: TIMESTAMP, updated_at: TIMESTAMP
      };
      this.findings.push(finding);
    }

    // After the stub-creation block, finding is guaranteed to be defined.
    const f = finding!;
    const finalStatus = f.human_override_status ?? input.deterministicParentStatus;
    f.deterministic_derived_status = input.deterministicParentStatus as FindingRow["status"];
    f.status = finalStatus as FindingRow["status"];
    f.reasoning = input.deterministicParentReasoning;

    return {
      evaluationId: newEval.id,
      parentStatus: finalStatus,
      deterministicStatus: input.deterministicParentStatus,
      humanOverridePreserved: f.human_override_status !== null,
      revisionNumber: revision
    };
  }

  async writeAudit(records: ComplianceAuditRecord[]): Promise<void> {
    this.audits.push(...records);
  }
}
