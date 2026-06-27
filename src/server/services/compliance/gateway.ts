import type { Database } from "@/types/database";

export type RequirementConditionRow = Database["public"]["Tables"]["requirement_conditions"]["Row"];
export type RequirementConditionInsert = Database["public"]["Tables"]["requirement_conditions"]["Insert"];
export type RequirementConditionUpdate = Database["public"]["Tables"]["requirement_conditions"]["Update"];

export type ConditionEvaluationRow = Database["public"]["Tables"]["condition_evaluations"]["Row"];
export type ConditionEvaluationInsert = Database["public"]["Tables"]["condition_evaluations"]["Insert"];
export type ConditionEvaluationUpdate = Database["public"]["Tables"]["condition_evaluations"]["Update"];

export type ConditionEvidenceRegionRow = Database["public"]["Tables"]["condition_evidence_regions"]["Row"];
export type ConditionEvidenceRegionInsert = Database["public"]["Tables"]["condition_evidence_regions"]["Insert"];

export type FindingRow = Database["public"]["Tables"]["compliance_findings"]["Row"];

export type RequirementScope = {
  id: string;
  projectId: string;
  organizationId: string;
};

export type EvidenceRegionScope = {
  id: string;
  organizationId: string;
  projectId: string;
  documentId: string;
};

export type FindingStatusUpdate = {
  deterministicDerivedStatus: string;
  finalStatus: string;
  reasoning: string;
};

export type TransactionalPersistInput = {
  organizationId: string;
  projectId: string;
  reviewId: string;
  findingId: string;
  requirementId: string;
  requirementConditionId: string;
  status: string;
  evidenceSummary: string | null;
  reasoning: string;
  contradictionReasoning: string | null;
  missingInformation: string | null;
  verificationFailureReason: string | null;
  contractorAction: string | null;
  confidenceScore: number;
  weightageScore: number;
  isHumanReviewRequired: boolean;
  evidenceLinks: Array<{ regionId: string | null; relationshipType: string }>;
  deterministicParentStatus: string;
  deterministicParentReasoning: string;
  deterministicRequiresHumanReview: boolean;
  createdBy: string;
};

export type TransactionalPersistResult = {
  evaluationId: string;
  parentStatus: string;
  deterministicStatus: string;
  humanOverridePreserved: boolean;
  revisionNumber: number;
};

export type ComplianceAuditRecord = {
  organizationId: string;
  projectId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
};

export interface CompliancePersistenceGateway {
  getRequirementScope(requirementId: string, projectId: string): Promise<RequirementScope | null>;
  listActiveConditionsByRequirement(requirementId: string): Promise<RequirementConditionRow[]>;
  listActiveConditionsByProject(projectId: string, organizationId: string): Promise<RequirementConditionRow[]>;
  getCondition(conditionId: string, organizationId: string): Promise<RequirementConditionRow | null>;
  insertConditions(conditions: RequirementConditionInsert[]): Promise<RequirementConditionRow[]>;
  supersedConditions(conditionIds: string[], reason: string): Promise<void>;
  markConditionHumanConfirmed(conditionId: string, confirmed: boolean): Promise<void>;

  getActiveEvaluationByCondition(reviewId: string, conditionId: string): Promise<ConditionEvaluationRow | null>;
  listActiveEvaluationsByFinding(findingId: string, organizationId: string): Promise<ConditionEvaluationRow[]>;
  listActiveEvaluationsByReview(reviewId: string, organizationId: string): Promise<ConditionEvaluationRow[]>;
  getEvaluationWithCondition(
    evaluationId: string,
    organizationId: string
  ): Promise<(ConditionEvaluationRow & { condition: RequirementConditionRow | null }) | null>;
  insertEvaluation(evaluation: ConditionEvaluationInsert): Promise<ConditionEvaluationRow>;
  updateEvaluation(id: string, organizationId: string, update: ConditionEvaluationUpdate): Promise<ConditionEvaluationRow | null>;
  supersedEvaluation(evaluationId: string, reason: string): Promise<void>;
  applyHumanReviewStatus(
    evaluationId: string,
    organizationId: string,
    humanStatus: string,
    humanComment: string | null,
    reviewerId: string,
    reviewedAt: string
  ): Promise<ConditionEvaluationRow | null>;

  getEvidenceRegionScope(regionId: string): Promise<EvidenceRegionScope | null>;
  listEvidenceLinksForEvaluation(evaluationId: string): Promise<ConditionEvidenceRegionRow[]>;
  listEvaluationsForRegion(regionId: string, organizationId: string): Promise<ConditionEvidenceRegionRow[]>;
  insertEvidenceLink(link: ConditionEvidenceRegionInsert): Promise<ConditionEvidenceRegionRow>;
  deleteEvidenceLink(linkId: string): Promise<void>;

  getFinding(findingId: string, projectId: string): Promise<FindingRow | null>;
  updateFindingDerivedStatus(findingId: string, projectId: string, update: FindingStatusUpdate): Promise<void>;

  persistEvaluationAndRefreshParent(input: TransactionalPersistInput): Promise<TransactionalPersistResult>;

  writeAudit(records: ComplianceAuditRecord[]): Promise<void>;
}
