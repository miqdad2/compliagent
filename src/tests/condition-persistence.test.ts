import { describe, expect, it } from "vitest";
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
} from "@/server/services/compliance/gateway";
import { RequirementConditionsService } from "@/server/services/compliance/requirement-conditions";
import { ConditionEvaluationsService } from "@/server/services/compliance/condition-evaluations";
import { ConditionEvidenceService } from "@/server/services/compliance/condition-evidence";
import { ParentFindingService } from "@/server/services/compliance/parent-finding";
import { deriveParentFindingStatus } from "@/lib/compliance/parent-finding";
import { HumanApprovalProtectedError } from "@/server/services/compliance/supabase-compliance-gateway";

// ============================================================
// Shared test IDs
// ============================================================

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  otherOrganization: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  otherProject: "44444444-4444-4444-8444-444444444444",
  requirement: "55555555-5555-4555-8555-555555555555",
  review: "66666666-6666-4666-8666-666666666666",
  finding: "77777777-7777-4777-8777-777777777777",
  sizeCondition: "88888888-8888-4888-8888-888888888888",
  qualityCondition: "99999999-9999-4999-8999-999999999999",
  typeCondition: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  magnetCondition: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  evaluation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  region: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  otherRegion: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  link: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  reviewer: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000002"
};

const timestamp = "2026-06-25T00:00:00.000Z";

// ============================================================
// In-memory gateway implementation
// ============================================================

class MemoryComplianceGateway implements CompliancePersistenceGateway {
  requirementScopes: Record<string, RequirementScope> = {
    [ids.requirement]: { id: ids.requirement, projectId: ids.project, organizationId: ids.organization }
  };
  conditions: RequirementConditionRow[] = [];
  evaluations: ConditionEvaluationRow[] = [];
  evidenceLinks: ConditionEvidenceRegionRow[] = [];
  evidenceRegions: Record<string, EvidenceRegionScope> = {
    [ids.region]: { id: ids.region, organizationId: ids.organization, projectId: ids.project, documentId: "doc-1" },
    [ids.otherRegion]: { id: ids.otherRegion, organizationId: ids.otherOrganization, projectId: ids.otherProject, documentId: "doc-2" }
  };
  findings: FindingRow[] = [makeFinding()];
  audits: ComplianceAuditRecord[] = [];
  transactionShouldFail = false;
  transactionShouldFailWithHumanProtection = false;

  private nextId = 1;
  private newId() {
    return `id-${this.nextId++}`;
  }

  async getRequirementScope(requirementId: string, projectId: string): Promise<RequirementScope | null> {
    const scope = this.requirementScopes[requirementId];
    return scope?.projectId === projectId ? scope : null;
  }

  async listActiveConditionsByRequirement(requirementId: string): Promise<RequirementConditionRow[]> {
    return this.conditions.filter((c) => c.requirement_id === requirementId && c.is_active);
  }

  async listActiveConditionsByProject(projectId: string, organizationId: string): Promise<RequirementConditionRow[]> {
    return this.conditions.filter((c) => c.project_id === projectId && c.organization_id === organizationId && c.is_active);
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
      created_at: timestamp,
      updated_at: timestamp
    }));
    this.conditions.push(...rows);
    return rows;
  }

  async supersedConditions(conditionIds: string[], reason: string): Promise<void> {
    for (const id of conditionIds) {
      const condition = this.conditions.find((c) => c.id === id);
      if (condition) {
        condition.is_active = false;
        condition.superseded_at = timestamp;
        condition.superseded_reason = reason;
      }
    }
  }

  async markConditionHumanConfirmed(conditionId: string, confirmed: boolean): Promise<void> {
    const condition = this.conditions.find((c) => c.id === conditionId);
    if (condition) condition.is_human_confirmed = confirmed;
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
      created_at: timestamp,
      updated_at: timestamp
    };
    this.evaluations.push(row);
    return row;
  }

  async updateEvaluation(id: string, organizationId: string, update: ConditionEvaluationUpdate): Promise<ConditionEvaluationRow | null> {
    const evaluation = this.evaluations.find((e) => e.id === id && e.organization_id === organizationId);
    if (!evaluation) return null;
    Object.assign(evaluation, update);
    return evaluation;
  }

  async supersedEvaluation(evaluationId: string, reason: string): Promise<void> {
    const evaluation = this.evaluations.find((e) => e.id === evaluationId);
    if (evaluation) {
      evaluation.is_active = false;
      evaluation.superseded_at = timestamp;
      evaluation.superseded_reason = reason;
    }
  }

  async applyHumanReviewStatus(
    evaluationId: string,
    organizationId: string,
    humanStatus: string,
    humanComment: string | null,
    reviewerId: string,
    reviewedAt: string
  ): Promise<ConditionEvaluationRow | null> {
    const evaluation = this.evaluations.find((e) => e.id === evaluationId && e.organization_id === organizationId);
    if (!evaluation) return null;
    evaluation.human_status = humanStatus as ConditionEvaluationRow["human_status"];
    evaluation.human_comment = humanComment;
    evaluation.reviewed_by = reviewerId;
    evaluation.reviewed_at = reviewedAt;
    return evaluation;
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
      created_at: timestamp
    };
    this.evidenceLinks.push(row);
    return row;
  }

  async deleteEvidenceLink(linkId: string): Promise<void> {
    const idx = this.evidenceLinks.findIndex((l) => l.id === linkId);
    if (idx >= 0) this.evidenceLinks.splice(idx, 1);
  }

  async getFinding(findingId: string, projectId: string): Promise<FindingRow | null> {
    return this.findings.find((f) => f.id === findingId && f.project_id === projectId) ?? null;
  }

  async updateFindingDerivedStatus(findingId: string, projectId: string, update: FindingStatusUpdate): Promise<void> {
    const finding = this.findings.find((f) => f.id === findingId && f.project_id === projectId);
    if (finding) {
      finding.deterministic_derived_status = update.deterministicDerivedStatus as FindingRow["status"];
      finding.status = update.finalStatus as FindingRow["status"];
      finding.reasoning = update.reasoning;
    }
  }

  async persistEvaluationAndRefreshParent(input: TransactionalPersistInput): Promise<TransactionalPersistResult> {
    if (this.transactionShouldFail) {
      throw new Error("TRANSACTION_FAILED: Simulated database error.");
    }
    if (this.transactionShouldFailWithHumanProtection) {
      throw new HumanApprovalProtectedError();
    }

    const existingActive = this.evaluations.find(
      (e) => e.review_id === input.reviewId && e.requirement_condition_id === input.requirementConditionId && e.is_active
    );
    if (existingActive?.human_status != null) {
      throw new HumanApprovalProtectedError();
    }

    if (existingActive) {
      existingActive.is_active = false;
      existingActive.superseded_at = timestamp;
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
      human_status: null,
      human_comment: null,
      reviewed_by: null,
      reviewed_at: null,
      is_active: true,
      revision_number: revision,
      superseded_at: null,
      superseded_reason: null,
      created_at: timestamp,
      updated_at: timestamp
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
        created_at: timestamp
      });
    }

    const finding = this.findings.find((f) => f.id === input.findingId);
    if (!finding) throw new Error("FINDING_NOT_FOUND");

    const finalStatus = finding.human_override_status ?? input.deterministicParentStatus;
    finding.deterministic_derived_status = input.deterministicParentStatus as FindingRow["status"];
    finding.status = finalStatus as FindingRow["status"];
    finding.reasoning = input.deterministicParentReasoning;

    return {
      evaluationId: newEval.id,
      parentStatus: finalStatus,
      deterministicStatus: input.deterministicParentStatus,
      humanOverridePreserved: finding.human_override_status !== null,
      revisionNumber: revision
    };
  }

  async writeAudit(records: ComplianceAuditRecord[]): Promise<void> {
    this.audits.push(...records);
  }
}

// ============================================================
// Test fixtures
// ============================================================

function makeFinding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: ids.finding,
    organization_id: ids.organization,
    review_id: ids.review,
    project_id: ids.project,
    requirement_id: ids.requirement,
    evidence_id: null,
    clause_number: "3.2",
    sub_clause_number: null,
    requirement_text: "Drivers must be high-quality full-range units (3.5\" to 4\") with neodymium magnets.",
    evidence_text: null,
    status: "not_proven",
    ai_derived_status: null,
    deterministic_derived_status: null,
    weightage_score: 8,
    confidence_score: 90,
    reasoning: "No condition evaluations exist yet.",
    missing_information: null,
    contractor_action: null,
    risk_level: "medium",
    human_override_status: null,
    human_comment: null,
    reviewer_comment: null,
    reviewed_by: null,
    reviewed_at: null,
    annotation_ready: false,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides
  };
}

function baseConditionInput() {
  return {
    conditionOrder: 1,
    conditionKey: "driver_size",
    conditionType: "numeric_range" as const,
    subject: "driver",
    attribute: "diameter",
    operator: "between" as const,
    expectedMinValue: 3.5,
    expectedMaxValue: 4,
    expectedUnit: "in",
    isMandatory: true,
    sourceText: "Drivers must be high-quality full-range units (3.5\" to 4\") with neodymium magnets.",
    extractionConfidence: 95
  };
}

function baseEvaluationInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ids.organization,
    projectId: ids.project,
    reviewId: ids.review,
    findingId: ids.finding,
    requirementId: ids.requirement,
    requirementConditionId: ids.sizeCondition,
    status: "not_proven" as const,
    evidenceSummary: null,
    reasoning: "No direct size evidence was located.",
    contradictionReasoning: null,
    missingInformation: "Provide driver diameter documentation.",
    verificationFailureReason: null,
    contractorAction: null,
    confidenceScore: 90,
    weightageScore: 8,
    isHumanReviewRequired: true,
    requestingUserId: ids.user,
    ...overrides
  };
}

// ============================================================
// Test: Requirement condition creation
// ============================================================

describe("1. Create requirement conditions", () => {
  it("creates conditions for one extracted requirement", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new RequirementConditionsService(gateway);
    const result = await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [baseConditionInput()]
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].condition_key).toBe("driver_size");
      expect(result.data[0].is_active).toBe(true);
    }
    expect(gateway.audits.some((a) => a.action === "requirement_conditions.created")).toBe(true);
  });
});

describe("2. Reject duplicate condition order/key", () => {
  it("rejects a second condition with the same order", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new RequirementConditionsService(gateway);
    await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [baseConditionInput()]
    });
    const result = await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [{ ...baseConditionInput(), conditionKey: "different_key" }]
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("DUPLICATE_CONDITION");
    }
  });

  it("rejects a second condition with the same key", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new RequirementConditionsService(gateway);
    await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [baseConditionInput()]
    });
    const result = await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [{ ...baseConditionInput(), conditionOrder: 99 }]
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("DUPLICATE_CONDITION");
    }
  });
});

describe("3. Reject cross-organization requirement writes", () => {
  it("fails when the requirement belongs to a different organization", async () => {
    const gateway = new MemoryComplianceGateway();
    gateway.requirementScopes[ids.requirement] = {
      id: ids.requirement,
      projectId: ids.project,
      organizationId: ids.otherOrganization
    };
    const service = new RequirementConditionsService(gateway);
    const result = await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [baseConditionInput()]
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("ORGANIZATION_ACCESS_DENIED");
    }
  });
});

describe("4. Create condition evaluation", () => {
  it("creates a draft evaluation with valid NOT_PROVEN status", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    const result = await service.createDraftEvaluation(baseEvaluationInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("not_proven");
      expect(result.data.is_active).toBe(true);
      expect(result.data.revision_number).toBe(1);
    }
  });
});

describe("5. COMPLIED without evidence is rejected", () => {
  it("fails when creating a COMPLIED evaluation without evidence summary", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    const result = await service.createDraftEvaluation(
      baseEvaluationInput({ status: "complied", evidenceSummary: null })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("INVALID_EVALUATION");
    }
  });

  it("fails when creating an EXCEEDS_REQUIREMENT evaluation without evidence", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    const result = await service.createDraftEvaluation(
      baseEvaluationInput({ status: "exceeds_requirement", evidenceSummary: null })
    );
    expect(result.success).toBe(false);
  });

  it("succeeds when COMPLIED evaluation provides evidence summary", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    const result = await service.createDraftEvaluation(
      baseEvaluationInput({ status: "complied", evidenceSummary: '3.5" drivers confirmed in datasheet.', missingInformation: null })
    );
    expect(result.success).toBe(true);
  });
});

describe("6. NOT_PROVEN without missing information is rejected", () => {
  it("fails when NOT_PROVEN provides no missing information", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    const result = await service.createDraftEvaluation(
      baseEvaluationInput({ status: "not_proven", missingInformation: null })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("INVALID_EVALUATION");
    }
  });
});

describe("7. NOT_COMPLIED without contradiction reasoning is rejected", () => {
  it("fails when NOT_COMPLIED provides no contradiction reasoning", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    const result = await service.createDraftEvaluation(
      baseEvaluationInput({ status: "not_complied", contradictionReasoning: null })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("INVALID_EVALUATION");
    }
  });
});

describe("8. Link supporting evidence", () => {
  it("links a supporting evidence region to an evaluation", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvidenceService(gateway);
    const result = await service.linkEvidenceRegion({
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.region,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "supports",
      requestingUserId: ids.user
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relationship_type).toBe("supports");
      expect(result.data.evidence_region_id).toBe(ids.region);
    }
  });
});

describe("9. Link contradictory evidence", () => {
  it("links a contradicting evidence region to an evaluation", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvidenceService(gateway);
    const result = await service.linkEvidenceRegion({
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.region,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "contradicts",
      requestingUserId: ids.user
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relationship_type).toBe("contradicts");
    }
  });
});

describe("10. Reject duplicate evidence link", () => {
  it("rejects linking the same region twice to the same evaluation", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvidenceService(gateway);
    await service.linkEvidenceRegion({
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.region,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "supports",
      requestingUserId: ids.user
    });
    const result = await service.linkEvidenceRegion({
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.region,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "contextual",
      requestingUserId: ids.user
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("DUPLICATE_EVIDENCE_LINK");
    }
  });
});

describe("11. Reject cross-project evidence link", () => {
  it("rejects linking an evidence region from a different project", async () => {
    const gateway = new MemoryComplianceGateway();
    gateway.evidenceRegions[ids.otherRegion] = {
      id: ids.otherRegion,
      organizationId: ids.organization,
      projectId: ids.otherProject,
      documentId: "doc-x"
    };
    const service = new ConditionEvidenceService(gateway);
    const result = await service.linkEvidenceRegion({
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.otherRegion,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "supports",
      requestingUserId: ids.user
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("CROSS_PROJECT_LINK_DENIED");
    }
  });
});

describe("12. Reject cross-organization evidence link", () => {
  it("rejects linking an evidence region from a different organization", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvidenceService(gateway);
    const result = await service.linkEvidenceRegion({
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.otherRegion,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "supports",
      requestingUserId: ids.user
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("CROSS_ORGANIZATION_LINK_DENIED");
    }
  });
});

describe("13. All child conditions complied → parent complied", () => {
  it("derives COMPLIED when all mandatory conditions are proven", () => {
    const result = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "complied", isMandatory: true },
      { id: ids.qualityCondition, status: "complied", isMandatory: true }
    ]);
    expect(result.status).toBe("complied");
    expect(result.appliedRule).toBe("all_mandatory_complied");
  });
});

describe("14. Mixed complied and not proven → parent partially complied", () => {
  it("derives PARTIALLY_COMPLIED for the driver size / neodymium example", () => {
    const result = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "complied", isMandatory: true },
      { id: ids.qualityCondition, status: "not_proven", isMandatory: true },
      { id: ids.magnetCondition, status: "not_proven", isMandatory: true }
    ]);
    expect(result.status).toBe("partially_complied");
    expect(result.compliedConditionIds).toEqual([ids.sizeCondition]);
    expect(result.unresolvedConditionIds).toContain(ids.qualityCondition);
    expect(result.unresolvedConditionIds).toContain(ids.magnetCondition);
  });
});

describe("15. Mandatory not complied → parent not complied", () => {
  it("derives NOT_COMPLIED when any mandatory condition has a direct contradiction", () => {
    const result = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "complied", isMandatory: true },
      { id: ids.magnetCondition, status: "not_complied", isMandatory: true }
    ]);
    expect(result.status).toBe("not_complied");
    expect(result.appliedRule).toBe("mandatory_contradiction");
    expect(result.contradictoryConditionIds).toEqual([ids.magnetCondition]);
  });
});

describe("16. All exceeds/complied → parent exceeds requirement", () => {
  it("derives EXCEEDS_REQUIREMENT only when all conditions exceed", () => {
    const allExceeds = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "exceeds_requirement", isMandatory: true },
      { id: ids.magnetCondition, status: "exceeds_requirement", isMandatory: true }
    ]);
    expect(allExceeds.status).toBe("exceeds_requirement");
    expect(allExceeds.appliedRule).toBe("all_exceed_requirement");
    expect(allExceeds.exceedsConditionIds).toHaveLength(2);

    const mixed = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "complied", isMandatory: true },
      { id: ids.magnetCondition, status: "exceeds_requirement", isMandatory: true }
    ]);
    expect(mixed.status).toBe("complied");
    expect(mixed.exceedsConditionIds).toHaveLength(1);
    expect(mixed.compliedConditionIds).toHaveLength(1);
  });
});

describe("17. All not applicable → parent not applicable", () => {
  it("derives NOT_APPLICABLE when all conditions are out of scope", () => {
    const result = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "not_applicable", isMandatory: true },
      { id: ids.magnetCondition, status: "not_applicable", isMandatory: true }
    ]);
    expect(result.status).toBe("not_applicable");
    expect(result.appliedRule).toBe("all_not_applicable");
  });
});

describe("18. Extraction failure → parent not verified", () => {
  it("derives NOT_VERIFIED when any condition has an extraction failure", () => {
    const result = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "complied", isMandatory: true },
      { id: ids.magnetCondition, status: "not_verified", isMandatory: true }
    ]);
    expect(result.status).toBe("not_verified");
    expect(result.appliedRule).toBe("verification_failure_precedence");
    expect(result.verificationFailureConditionIds).toEqual([ids.magnetCondition]);
  });

  it("derives NOT_VERIFIED when no evaluations exist", () => {
    const result = deriveParentFindingStatus([]);
    expect(result.status).toBe("not_verified");
    expect(result.appliedRule).toBe("no_evaluations");
  });
});

describe("19. Optional condition does not incorrectly fail parent", () => {
  it("excludes non-mandatory conditions from parent derivation when mandatory conditions exist", () => {
    const result = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "complied", isMandatory: true },
      { id: ids.qualityCondition, status: "not_complied", isMandatory: false }
    ]);
    expect(result.status).toBe("complied");
    expect(result.mandatoryConditionCount).toBe(1);
  });
});

describe("20. Human override survives recalculation", () => {
  it("uses humanStatus in derivation while preserving sibling conditions", () => {
    const result = deriveParentFindingStatus([
      { id: ids.sizeCondition, status: "not_proven", humanStatus: "complied", isMandatory: true },
      { id: ids.magnetCondition, status: "not_proven", isMandatory: true }
    ]);
    expect(result.status).toBe("partially_complied");
    expect(result.compliedConditionIds).toContain(ids.sizeCondition);
  });

  it("preserves the finding human_override_status when the transactional RPC is called", async () => {
    const gateway = new MemoryComplianceGateway();
    gateway.findings = [makeFinding({ human_override_status: "complied" })];
    const service = new ParentFindingService(gateway);
    const result = await service.persistEvaluationAndRefreshParent({
      organizationId: ids.organization,
      projectId: ids.project,
      reviewId: ids.review,
      findingId: ids.finding,
      requirementId: ids.requirement,
      requirementConditionId: ids.sizeCondition,
      status: "not_proven",
      evidenceSummary: null,
      reasoning: "No evidence found.",
      contradictionReasoning: null,
      missingInformation: "Provide documentation.",
      verificationFailureReason: null,
      contractorAction: null,
      confidenceScore: 90,
      weightageScore: 5,
      isHumanReviewRequired: true,
      evidenceLinks: [],
      requestingUserId: ids.user
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.humanOverridePreserved).toBe(true);
      expect(result.data.parentStatus).toBe("complied");
    }
  });
});

describe("21. Superseded evaluations are excluded from parent derivation", () => {
  it("only uses active evaluations in parent derivation", async () => {
    const gateway = new MemoryComplianceGateway();
    gateway.evaluations.push(
      {
        id: "old-eval",
        organization_id: ids.organization,
        project_id: ids.project,
        review_id: ids.review,
        finding_id: ids.finding,
        requirement_id: ids.requirement,
        requirement_condition_id: ids.sizeCondition,
        status: "not_complied",
        evidence_summary: null,
        reasoning: "Old contradicting evaluation.",
        contradiction_reasoning: "Explicitly contradicted.",
        missing_information: null,
        verification_failure_reason: null,
        contractor_action: null,
        confidence_score: 80,
        weightage_score: 5,
        is_human_review_required: true,
        human_status: null,
        human_comment: null,
        reviewed_by: null,
        reviewed_at: null,
        is_active: false,
        revision_number: 1,
        superseded_at: timestamp,
        superseded_reason: "reprocessed",
        created_at: timestamp,
        updated_at: timestamp
      }
    );
    const service = new ParentFindingService(gateway);
    const result = await service.computeParentStatus(ids.finding, ids.organization);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("not_verified");
      expect(result.data.contradictoryConditionIds).toHaveLength(0);
    }
  });
});

describe("22. Transaction failure rolls back all writes", () => {
  it("returns TRANSACTION_FAILED when the RPC fails and writes an audit event", async () => {
    const gateway = new MemoryComplianceGateway();
    gateway.transactionShouldFail = true;
    const service = new ParentFindingService(gateway);
    const result = await service.persistEvaluationAndRefreshParent({
      organizationId: ids.organization,
      projectId: ids.project,
      reviewId: ids.review,
      findingId: ids.finding,
      requirementId: ids.requirement,
      requirementConditionId: ids.sizeCondition,
      status: "not_proven",
      evidenceSummary: null,
      reasoning: "No evidence found.",
      contradictionReasoning: null,
      missingInformation: "Provide documentation.",
      verificationFailureReason: null,
      contractorAction: null,
      confidenceScore: 90,
      weightageScore: 5,
      isHumanReviewRequired: true,
      evidenceLinks: [],
      requestingUserId: ids.user
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("TRANSACTION_FAILED");
      expect(result.retryable).toBe(true);
    }
    expect(gateway.audits.some((a) => a.action === "parent_finding.transaction_failed")).toBe(true);
    expect(gateway.evaluations.filter((e) => e.is_active)).toHaveLength(0);
  });
});

describe("23. Audit events are written", () => {
  it("writes condition_evaluation.created audit when creating an evaluation", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    await service.createDraftEvaluation(baseEvaluationInput());
    expect(gateway.audits.some((a) => a.action === "condition_evaluation.created")).toBe(true);
  });

  it("writes requirement_conditions.created audit when creating conditions", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new RequirementConditionsService(gateway);
    await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [baseConditionInput()]
    });
    expect(gateway.audits.some((a) => a.action === "requirement_conditions.created")).toBe(true);
  });

  it("writes condition_evidence.linked audit when linking evidence", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvidenceService(gateway);
    await service.linkEvidenceRegion({
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.region,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "supports",
      requestingUserId: ids.user
    });
    expect(gateway.audits.some((a) => a.action === "condition_evidence.linked")).toBe(true);
  });
});

describe("24. Confidential evidence text is not written to audit metadata", () => {
  it("does not include evidence text in audit metadata for condition creation", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new ConditionEvaluationsService(gateway);
    await service.createDraftEvaluation(
      baseEvaluationInput({ evidenceSummary: "3.5\" drivers confirmed." })
    );
    const auditMetadataAsText = JSON.stringify(gateway.audits.map((a) => a.metadata));
    expect(auditMetadataAsText).not.toContain('3.5" drivers confirmed.');
  });

  it("does not include source text in condition creation audit metadata", async () => {
    const gateway = new MemoryComplianceGateway();
    const service = new RequirementConditionsService(gateway);
    await service.createConditions({
      organizationId: ids.organization,
      projectId: ids.project,
      requirementId: ids.requirement,
      requestingUserId: ids.user,
      conditions: [baseConditionInput()]
    });
    const auditMetadataAsText = JSON.stringify(gateway.audits.map((a) => a.metadata));
    expect(auditMetadataAsText).not.toContain("3.5");
  });
});

describe("25. Driver example produces partial compliance", () => {
  it("evaluates the complete speaker driver requirement correctly", async () => {
    const gateway = new MemoryComplianceGateway();
    const parentService = new ParentFindingService(gateway);

    // Pre-load active evaluations representing condition-level AI analysis
    // Evidence: only "3.5-inch drivers" was found.
    // Condition 1: driver_size (3.5-4") → COMPLIED (evidence: "3.5-inch drivers")
    // Condition 2: driver_quality → NOT_PROVEN
    // Condition 3: driver_type → NOT_PROVEN (AMBIGUOUS - unclear from evidence)
    // Condition 4: magnet_type → NOT_PROVEN

    gateway.evaluations.push(
      {
        id: "eval-size",
        organization_id: ids.organization,
        project_id: ids.project,
        review_id: ids.review,
        finding_id: ids.finding,
        requirement_id: ids.requirement,
        requirement_condition_id: ids.sizeCondition,
        status: "complied",
        evidence_summary: '3.5-inch drivers found in submission.',
        reasoning: 'The submission states "3.5-inch drivers" which falls within 3.5" to 4".',
        contradiction_reasoning: null,
        missing_information: null,
        verification_failure_reason: null,
        contractor_action: null,
        confidence_score: 95,
        weightage_score: 8,
        is_human_review_required: false,
        human_status: null,
        human_comment: null,
        reviewed_by: null,
        reviewed_at: null,
        is_active: true,
        revision_number: 1,
        superseded_at: null,
        superseded_reason: null,
        created_at: timestamp,
        updated_at: timestamp
      },
      {
        id: "eval-quality",
        organization_id: ids.organization,
        project_id: ids.project,
        review_id: ids.review,
        finding_id: ids.finding,
        requirement_id: ids.requirement,
        requirement_condition_id: ids.qualityCondition,
        status: "not_proven",
        evidence_summary: null,
        reasoning: "No mention of driver quality in the submission.",
        contradiction_reasoning: null,
        missing_information: "Provide quality grade or specification reference.",
        verification_failure_reason: null,
        contractor_action: null,
        confidence_score: 85,
        weightage_score: 6,
        is_human_review_required: true,
        human_status: null,
        human_comment: null,
        reviewed_by: null,
        reviewed_at: null,
        is_active: true,
        revision_number: 1,
        superseded_at: null,
        superseded_reason: null,
        created_at: timestamp,
        updated_at: timestamp
      },
      {
        id: "eval-type",
        organization_id: ids.organization,
        project_id: ids.project,
        review_id: ids.review,
        finding_id: ids.finding,
        requirement_id: ids.requirement,
        requirement_condition_id: ids.typeCondition,
        status: "ambiguous",
        evidence_summary: '"3.5-inch drivers" implies full-range but is not explicitly stated.',
        reasoning: "The phrase 3.5-inch drivers could refer to full-range or woofer — clarification needed.",
        contradiction_reasoning: null,
        missing_information: "State explicitly that the drivers are full-range.",
        verification_failure_reason: null,
        contractor_action: null,
        confidence_score: 60,
        weightage_score: 7,
        is_human_review_required: true,
        human_status: null,
        human_comment: null,
        reviewed_by: null,
        reviewed_at: null,
        is_active: true,
        revision_number: 1,
        superseded_at: null,
        superseded_reason: null,
        created_at: timestamp,
        updated_at: timestamp
      },
      {
        id: "eval-magnet",
        organization_id: ids.organization,
        project_id: ids.project,
        review_id: ids.review,
        finding_id: ids.finding,
        requirement_id: ids.requirement,
        requirement_condition_id: ids.magnetCondition,
        status: "not_proven",
        evidence_summary: null,
        reasoning: "No mention of magnet type in the submission.",
        contradiction_reasoning: null,
        missing_information: "Provide magnet type certification or datasheet.",
        verification_failure_reason: null,
        contractor_action: null,
        confidence_score: 90,
        weightage_score: 7,
        is_human_review_required: true,
        human_status: null,
        human_comment: null,
        reviewed_by: null,
        reviewed_at: null,
        is_active: true,
        revision_number: 1,
        superseded_at: null,
        superseded_reason: null,
        created_at: timestamp,
        updated_at: timestamp
      }
    );

    const derivationResult = await parentService.computeParentStatus(ids.finding, ids.organization);
    expect(derivationResult.success).toBe(true);
    if (derivationResult.success) {
      const { data } = derivationResult;
      expect(data.status).toBe("partially_complied");
      expect(data.compliedConditionIds).toContain("eval-size");
      expect(data.unresolvedConditionIds).toContain("eval-quality");
      expect(data.unresolvedConditionIds).toContain("eval-type");
      expect(data.unresolvedConditionIds).toContain("eval-magnet");
      expect(data.requiresHumanReview).toBe(true);
    }
  });
});
