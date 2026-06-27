import type { ConditionEvaluationStatus } from "@/lib/compliance/condition-schemas";
import { ok, fail, type ServiceResult } from "./types";
import type {
  CompliancePersistenceGateway,
  ConditionEvaluationRow,
  RequirementConditionRow
} from "./gateway";

export type CreateEvaluationInput = {
  organizationId: string;
  projectId: string;
  reviewId: string;
  findingId: string;
  requirementId: string;
  requirementConditionId: string;
  status: ConditionEvaluationStatus;
  evidenceSummary: string | null;
  reasoning: string;
  contradictionReasoning: string | null;
  missingInformation: string | null;
  verificationFailureReason: string | null;
  contractorAction: string | null;
  confidenceScore: number;
  weightageScore: number;
  isHumanReviewRequired: boolean;
  requestingUserId: string;
};

export type UpdateEvaluationInput = Omit<
  CreateEvaluationInput,
  "requirementId" | "requirementConditionId" | "requestingUserId"
> & {
  evaluationId: string;
  requestingUserId: string;
};

export type HumanReviewInput = {
  evaluationId: string;
  organizationId: string;
  humanStatus: ConditionEvaluationStatus;
  humanComment: string | null;
  reviewerId: string;
  reviewedAt: string;
};

export const EVALUATION_AUDIT_ACTIONS = {
  EVALUATION_CREATED: "condition_evaluation.created",
  EVALUATION_UPDATED: "condition_evaluation.updated",
  EVALUATION_SUPERSEDED: "condition_evaluation.superseded",
  HUMAN_REVIEW_APPLIED: "condition_evaluation.human_review_applied"
} as const;

function validateEvaluationStatus(input: {
  status: ConditionEvaluationStatus;
  evidenceSummary: string | null;
  contradictionReasoning: string | null;
  missingInformation: string | null;
  verificationFailureReason: string | null;
}): string | null {
  const hasEvidence = input.evidenceSummary !== null && input.evidenceSummary.trim().length > 0;

  if ((input.status === "complied" || input.status === "exceeds_requirement") && !hasEvidence) {
    return `${input.status} evaluations require an evidence summary.`;
  }

  if (input.status === "not_complied") {
    if (!input.contradictionReasoning || input.contradictionReasoning.trim().length === 0) {
      return "NOT_COMPLIED evaluations require contradiction reasoning.";
    }
  }

  if (input.status === "not_proven") {
    if (!input.missingInformation || input.missingInformation.trim().length === 0) {
      return "NOT_PROVEN evaluations require missing information explanation.";
    }
  }

  if (input.status === "not_verified") {
    if (!input.verificationFailureReason || input.verificationFailureReason.trim().length === 0) {
      return "NOT_VERIFIED evaluations require a verification failure reason.";
    }
  }

  if (input.status === "ambiguous" && !hasEvidence) {
    return "AMBIGUOUS evaluations require the unclear evidence that was found.";
  }

  if (input.status === "partially_complied" && (!hasEvidence || !input.missingInformation)) {
    return "PARTIALLY_COMPLIED evaluations require evidence and missing information.";
  }

  return null;
}

export class ConditionEvaluationsService {
  constructor(private readonly gateway: CompliancePersistenceGateway) {}

  async createDraftEvaluation(input: CreateEvaluationInput): Promise<ServiceResult<ConditionEvaluationRow>> {
    const validationError = validateEvaluationStatus(input);
    if (validationError) {
      return fail("INVALID_EVALUATION", validationError);
    }

    if (input.confidenceScore < 0 || input.confidenceScore > 100) {
      return fail("INVALID_EVALUATION", "Confidence score must be between 0 and 100.");
    }
    if (input.weightageScore < 0 || input.weightageScore > 10) {
      return fail("INVALID_EVALUATION", "Weightage score must be between 0 and 10.");
    }
    if (!input.reasoning.trim()) {
      return fail("INVALID_EVALUATION", "Reasoning is required.");
    }

    const existing = await this.gateway.getActiveEvaluationByCondition(input.reviewId, input.requirementConditionId);
    if (existing?.human_status != null) {
      return fail("HUMAN_APPROVAL_PROTECTED", "An existing human-reviewed evaluation for this condition cannot be superseded automatically.");
    }

    const row = await this.gateway.insertEvaluation({
      organization_id: input.organizationId,
      project_id: input.projectId,
      review_id: input.reviewId,
      finding_id: input.findingId,
      requirement_id: input.requirementId,
      requirement_condition_id: input.requirementConditionId,
      status: input.status,
      evidence_summary: input.evidenceSummary,
      reasoning: input.reasoning,
      contradiction_reasoning: input.contradictionReasoning,
      missing_information: input.missingInformation,
      verification_failure_reason: input.verificationFailureReason,
      contractor_action: input.contractorAction,
      confidence_score: input.confidenceScore,
      weightage_score: input.weightageScore,
      is_human_review_required: input.isHumanReviewRequired,
      is_active: true,
      revision_number: 1
    });

    await this.gateway.writeAudit([
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.requestingUserId,
        action: EVALUATION_AUDIT_ACTIONS.EVALUATION_CREATED,
        entityType: "condition_evaluations",
        entityId: row.id,
        metadata: { conditionId: input.requirementConditionId, status: input.status }
      }
    ]);

    return ok(row);
  }

  async updateAiDraftEvaluation(input: UpdateEvaluationInput): Promise<ServiceResult<ConditionEvaluationRow>> {
    const existing = await this.gateway.getActiveEvaluationByCondition(input.reviewId, input.evaluationId);
    if (!existing) {
      return fail("EVALUATION_NOT_FOUND", "The active evaluation was not found.");
    }
    if (existing.organization_id !== input.organizationId) {
      return fail("ORGANIZATION_ACCESS_DENIED", "Access denied.");
    }
    if (existing.human_status != null) {
      return fail("HUMAN_APPROVAL_PROTECTED", "A human-reviewed evaluation cannot be overwritten by AI.");
    }

    const validationError = validateEvaluationStatus(input);
    if (validationError) {
      return fail("INVALID_EVALUATION", validationError);
    }

    const updated = await this.gateway.updateEvaluation(existing.id, input.organizationId, {
      status: input.status,
      evidence_summary: input.evidenceSummary,
      reasoning: input.reasoning,
      contradiction_reasoning: input.contradictionReasoning,
      missing_information: input.missingInformation,
      verification_failure_reason: input.verificationFailureReason,
      contractor_action: input.contractorAction,
      confidence_score: input.confidenceScore,
      weightage_score: input.weightageScore,
      is_human_review_required: input.isHumanReviewRequired
    });

    if (!updated) {
      return fail("EVALUATION_NOT_FOUND", "The evaluation could not be updated.");
    }

    await this.gateway.writeAudit([
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.requestingUserId,
        action: EVALUATION_AUDIT_ACTIONS.EVALUATION_UPDATED,
        entityType: "condition_evaluations",
        entityId: updated.id,
        metadata: { status: input.status }
      }
    ]);

    return ok(updated);
  }

  async listByReview(reviewId: string, organizationId: string): Promise<ServiceResult<ConditionEvaluationRow[]>> {
    const rows = await this.gateway.listActiveEvaluationsByReview(reviewId, organizationId);
    return ok(rows);
  }

  async listByFinding(findingId: string, organizationId: string): Promise<ServiceResult<ConditionEvaluationRow[]>> {
    const rows = await this.gateway.listActiveEvaluationsByFinding(findingId, organizationId);
    return ok(rows);
  }

  async getWithCondition(
    evaluationId: string,
    organizationId: string
  ): Promise<ServiceResult<ConditionEvaluationRow & { condition: RequirementConditionRow | null }>> {
    const row = await this.gateway.getEvaluationWithCondition(evaluationId, organizationId);
    if (!row) {
      return fail("EVALUATION_NOT_FOUND", "The evaluation was not found.");
    }
    return ok(row);
  }

  async applyHumanReview(input: HumanReviewInput): Promise<ServiceResult<ConditionEvaluationRow>> {
    const existing = await this.gateway.getEvaluationWithCondition(input.evaluationId, input.organizationId);
    if (!existing) {
      return fail("EVALUATION_NOT_FOUND", "The evaluation was not found.");
    }

    const validationError = validateEvaluationStatus({
      status: input.humanStatus,
      evidenceSummary: existing.evidence_summary,
      contradictionReasoning: existing.contradiction_reasoning,
      missingInformation: existing.missing_information,
      verificationFailureReason: existing.verification_failure_reason
    });
    if (validationError) {
      return fail("INVALID_EVALUATION", validationError);
    }

    const updated = await this.gateway.applyHumanReviewStatus(
      input.evaluationId,
      input.organizationId,
      input.humanStatus,
      input.humanComment,
      input.reviewerId,
      input.reviewedAt
    );
    if (!updated) {
      return fail("EVALUATION_NOT_FOUND", "The evaluation could not be updated.");
    }

    await this.gateway.writeAudit([
      {
        organizationId: input.organizationId,
        projectId: existing.project_id,
        userId: input.reviewerId,
        action: EVALUATION_AUDIT_ACTIONS.HUMAN_REVIEW_APPLIED,
        entityType: "condition_evaluations",
        entityId: input.evaluationId,
        metadata: { humanStatus: input.humanStatus }
      }
    ]);

    return ok(updated);
  }

  async markSuperseded(
    evaluationId: string,
    organizationId: string,
    reason: string,
    requestingUserId: string
  ): Promise<ServiceResult<void>> {
    const existing = await this.gateway.getEvaluationWithCondition(evaluationId, organizationId);
    if (!existing) {
      return fail("EVALUATION_NOT_FOUND", "The evaluation was not found.");
    }
    if (existing.human_status != null) {
      return fail("HUMAN_APPROVAL_PROTECTED", "Human-reviewed evaluations cannot be superseded automatically.");
    }

    await this.gateway.supersedEvaluation(evaluationId, reason);

    await this.gateway.writeAudit([
      {
        organizationId,
        projectId: existing.project_id,
        userId: requestingUserId,
        action: EVALUATION_AUDIT_ACTIONS.EVALUATION_SUPERSEDED,
        entityType: "condition_evaluations",
        entityId: evaluationId,
        metadata: { reason }
      }
    ]);

    return ok(undefined);
  }
}
