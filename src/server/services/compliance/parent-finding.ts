import { deriveParentFindingStatus, type ParentConditionEvaluation } from "@/lib/compliance/parent-finding";
import type { ConditionEvaluationStatus, ParentFindingDerivationResult } from "@/lib/compliance/condition-schemas";
import { ok, fail, type ServiceResult } from "./types";
import type { CompliancePersistenceGateway, FindingRow, TransactionalPersistInput } from "./gateway";
import { HumanApprovalProtectedError, FindingNotFoundError } from "./supabase-compliance-gateway";

export type PersistEvaluationAndRefreshInput = {
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
  evidenceLinks: Array<{ regionId: string | null; relationshipType: string }>;
  requestingUserId: string;
};

export type PersistEvaluationAndRefreshResult = {
  evaluationId: string;
  derivation: ParentFindingDerivationResult;
  parentStatus: string;
  deterministicStatus: string;
  humanOverridePreserved: boolean;
  revisionNumber: number;
};

export const PARENT_FINDING_AUDIT_ACTIONS = {
  PARENT_RECALCULATED: "parent_finding.recalculated",
  HUMAN_OVERRIDE_PRESERVED: "parent_finding.human_override_preserved",
  TRANSACTION_FAILED: "parent_finding.transaction_failed"
} as const;

export class ParentFindingService {
  constructor(private readonly gateway: CompliancePersistenceGateway) {}

  async computeParentStatus(
    findingId: string,
    organizationId: string
  ): Promise<ServiceResult<ParentFindingDerivationResult>> {
    const evaluations = await this.gateway.listActiveEvaluationsByFinding(findingId, organizationId);
    const parentInputs: ParentConditionEvaluation[] = evaluations.map((evaluation) => ({
      id: evaluation.id,
      status: evaluation.status as ConditionEvaluationStatus,
      humanStatus: evaluation.human_status as ConditionEvaluationStatus | null,
      isMandatory: true,
      isHumanReviewRequired: evaluation.is_human_review_required
    }));
    return ok(deriveParentFindingStatus(parentInputs));
  }

  async persistEvaluationAndRefreshParent(
    input: PersistEvaluationAndRefreshInput
  ): Promise<ServiceResult<PersistEvaluationAndRefreshResult>> {
    const finding = await this.gateway.getFinding(input.findingId, input.projectId);
    if (!finding) {
      return fail("FINDING_NOT_FOUND", "The compliance finding was not found.");
    }

    const currentEvaluations = await this.gateway.listActiveEvaluationsByFinding(input.findingId, input.organizationId);

    const evaluationsForDerivation: ParentConditionEvaluation[] = [
      ...currentEvaluations
        .filter((e) => e.requirement_condition_id !== input.requirementConditionId)
        .map((e) => ({
          id: e.id,
          status: e.status as ConditionEvaluationStatus,
          humanStatus: e.human_status as ConditionEvaluationStatus | null,
          isMandatory: true,
          isHumanReviewRequired: e.is_human_review_required
        })),
      {
        id: "new-evaluation",
        status: input.status,
        humanStatus: null,
        isMandatory: true,
        isHumanReviewRequired: input.isHumanReviewRequired
      }
    ];

    const derivation = deriveParentFindingStatus(evaluationsForDerivation);

    const transactionalInput: TransactionalPersistInput = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      reviewId: input.reviewId,
      findingId: input.findingId,
      requirementId: input.requirementId,
      requirementConditionId: input.requirementConditionId,
      status: input.status,
      evidenceSummary: input.evidenceSummary,
      reasoning: input.reasoning,
      contradictionReasoning: input.contradictionReasoning,
      missingInformation: input.missingInformation,
      verificationFailureReason: input.verificationFailureReason,
      contractorAction: input.contractorAction,
      confidenceScore: input.confidenceScore,
      weightageScore: input.weightageScore,
      isHumanReviewRequired: input.isHumanReviewRequired,
      evidenceLinks: input.evidenceLinks,
      deterministicParentStatus: derivation.status,
      deterministicParentReasoning: derivation.reasoning,
      deterministicRequiresHumanReview: derivation.requiresHumanReview,
      createdBy: input.requestingUserId
    };

    try {
      const result = await this.gateway.persistEvaluationAndRefreshParent(transactionalInput);

      if (result.humanOverridePreserved) {
        await this.gateway.writeAudit([
          {
            organizationId: input.organizationId,
            projectId: input.projectId,
            userId: input.requestingUserId,
            action: PARENT_FINDING_AUDIT_ACTIONS.HUMAN_OVERRIDE_PRESERVED,
            entityType: "compliance_findings",
            entityId: input.findingId,
            metadata: {
              deterministicStatus: result.deterministicStatus,
              finalStatus: result.parentStatus
            }
          }
        ]);
      }

      return ok({
        evaluationId: result.evaluationId,
        derivation,
        parentStatus: result.parentStatus,
        deterministicStatus: result.deterministicStatus,
        humanOverridePreserved: result.humanOverridePreserved,
        revisionNumber: result.revisionNumber
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";

      if (error instanceof HumanApprovalProtectedError) {
        return fail("HUMAN_APPROVAL_PROTECTED", "The existing evaluation has been reviewed by a human and cannot be superseded.");
      }
      if (error instanceof FindingNotFoundError) {
        return fail("FINDING_NOT_FOUND", "The compliance finding was not found.");
      }

      await this.gateway.writeAudit([
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          userId: input.requestingUserId,
          action: PARENT_FINDING_AUDIT_ACTIONS.TRANSACTION_FAILED,
          entityType: "compliance_findings",
          entityId: input.findingId,
          metadata: { error: message.substring(0, 200) }
        }
      ]).catch(() => {});

      return fail("TRANSACTION_FAILED", "The persistence transaction could not be completed.", true);
    }
  }

  async getEffectiveStatus(finding: FindingRow): Promise<ConditionEvaluationStatus> {
    const effective = finding.human_override_status ?? finding.deterministic_derived_status ?? finding.status;
    return effective as ConditionEvaluationStatus;
  }
}
