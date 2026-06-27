import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

function gatewayError(message: string): never {
  throw new Error(message);
}

export class SupabaseComplianceGateway implements CompliancePersistenceGateway {
  constructor(private readonly client: AdminClient) {}

  async getRequirementScope(requirementId: string, projectId: string): Promise<RequirementScope | null> {
    const { data, error } = await this.client
      .from("extracted_requirements")
      .select("id, project_id, projects!inner(organization_id)")
      .eq("id", requirementId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) gatewayError("Failed to load requirement scope.");
    if (!data) return null;
    const row = data as typeof data & { projects: { organization_id: string } };
    return { id: row.id as string, projectId: row.project_id as string, organizationId: row.projects.organization_id };
  }

  async listActiveConditionsByRequirement(requirementId: string): Promise<RequirementConditionRow[]> {
    const { data, error } = await this.client
      .from("requirement_conditions")
      .select("*")
      .eq("requirement_id", requirementId)
      .eq("is_active", true)
      .order("condition_order", { ascending: true });
    if (error) gatewayError("Failed to list conditions.");
    return (data ?? []) as RequirementConditionRow[];
  }

  async listActiveConditionsByProject(projectId: string, organizationId: string): Promise<RequirementConditionRow[]> {
    const { data, error } = await this.client
      .from("requirement_conditions")
      .select("*")
      .eq("project_id", projectId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("condition_order", { ascending: true });
    if (error) gatewayError("Failed to list conditions by project.");
    return (data ?? []) as RequirementConditionRow[];
  }

  async getCondition(conditionId: string, organizationId: string): Promise<RequirementConditionRow | null> {
    const { data, error } = await this.client
      .from("requirement_conditions")
      .select("*")
      .eq("id", conditionId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) gatewayError("Failed to load condition.");
    return (data as RequirementConditionRow | null) ?? null;
  }

  async insertConditions(conditions: RequirementConditionInsert[]): Promise<RequirementConditionRow[]> {
    if (conditions.length === 0) return [];
    const { data, error } = await this.client.from("requirement_conditions").insert(conditions).select("*");
    if (error) gatewayError("Failed to insert conditions.");
    return (data ?? []) as RequirementConditionRow[];
  }

  async supersedConditions(conditionIds: string[], reason: string): Promise<void> {
    if (conditionIds.length === 0) return;
    const { error } = await this.client
      .from("requirement_conditions")
      .update({ is_active: false, superseded_at: new Date().toISOString(), superseded_reason: reason })
      .in("id", conditionIds);
    if (error) gatewayError("Failed to supersede conditions.");
  }

  async markConditionHumanConfirmed(conditionId: string, confirmed: boolean): Promise<void> {
    const { error } = await this.client
      .from("requirement_conditions")
      .update({ is_human_confirmed: confirmed })
      .eq("id", conditionId);
    if (error) gatewayError("Failed to update condition confirmation.");
  }

  async getActiveEvaluationByCondition(reviewId: string, conditionId: string): Promise<ConditionEvaluationRow | null> {
    const { data, error } = await this.client
      .from("condition_evaluations")
      .select("*")
      .eq("review_id", reviewId)
      .eq("requirement_condition_id", conditionId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) gatewayError("Failed to load evaluation.");
    return (data as ConditionEvaluationRow | null) ?? null;
  }

  async listActiveEvaluationsByFinding(findingId: string, organizationId: string): Promise<ConditionEvaluationRow[]> {
    const { data, error } = await this.client
      .from("condition_evaluations")
      .select("*")
      .eq("finding_id", findingId)
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    if (error) gatewayError("Failed to list evaluations by finding.");
    return (data ?? []) as ConditionEvaluationRow[];
  }

  async listActiveEvaluationsByReview(reviewId: string, organizationId: string): Promise<ConditionEvaluationRow[]> {
    const { data, error } = await this.client
      .from("condition_evaluations")
      .select("*")
      .eq("review_id", reviewId)
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    if (error) gatewayError("Failed to list evaluations by review.");
    return (data ?? []) as ConditionEvaluationRow[];
  }

  async getEvaluationWithCondition(
    evaluationId: string,
    organizationId: string
  ): Promise<(ConditionEvaluationRow & { condition: RequirementConditionRow | null }) | null> {
    const { data, error } = await this.client
      .from("condition_evaluations")
      .select("*, condition:requirement_conditions(*)")
      .eq("id", evaluationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) gatewayError("Failed to load evaluation with condition.");
    if (!data) return null;
    const { condition, ...evaluation } = data as typeof data & { condition: RequirementConditionRow | null };
    return { ...(evaluation as ConditionEvaluationRow), condition: condition ?? null };
  }

  async insertEvaluation(evaluation: ConditionEvaluationInsert): Promise<ConditionEvaluationRow> {
    const { data, error } = await this.client.from("condition_evaluations").insert(evaluation).select("*").single();
    if (error || !data) gatewayError("Failed to insert evaluation.");
    return data as ConditionEvaluationRow;
  }

  async updateEvaluation(id: string, organizationId: string, update: ConditionEvaluationUpdate): Promise<ConditionEvaluationRow | null> {
    const { data, error } = await this.client
      .from("condition_evaluations")
      .update(update)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("*")
      .maybeSingle();
    if (error) gatewayError("Failed to update evaluation.");
    return (data as ConditionEvaluationRow | null) ?? null;
  }

  async supersedEvaluation(evaluationId: string, reason: string): Promise<void> {
    const { error } = await this.client
      .from("condition_evaluations")
      .update({ is_active: false, superseded_at: new Date().toISOString(), superseded_reason: reason })
      .eq("id", evaluationId);
    if (error) gatewayError("Failed to supersede evaluation.");
  }

  async applyHumanReviewStatus(
    evaluationId: string,
    organizationId: string,
    humanStatus: string,
    humanComment: string | null,
    reviewerId: string,
    reviewedAt: string
  ): Promise<ConditionEvaluationRow | null> {
    const { data, error } = await this.client
      .from("condition_evaluations")
      .update({
        human_status: humanStatus as ConditionEvaluationRow["human_status"],
        human_comment: humanComment,
        reviewed_by: reviewerId,
        reviewed_at: reviewedAt
      })
      .eq("id", evaluationId)
      .eq("organization_id", organizationId)
      .select("*")
      .maybeSingle();
    if (error) gatewayError("Failed to apply human review status.");
    return (data as ConditionEvaluationRow | null) ?? null;
  }

  async getEvidenceRegionScope(regionId: string): Promise<EvidenceRegionScope | null> {
    const { data, error } = await this.client
      .from("evidence_regions")
      .select("id, organization_id, project_id, document_id")
      .eq("id", regionId)
      .maybeSingle();
    if (error) gatewayError("Failed to load evidence region scope.");
    if (!data) return null;
    return {
      id: data.id as string,
      organizationId: data.organization_id as string,
      projectId: data.project_id as string,
      documentId: data.document_id as string
    };
  }

  async listEvidenceLinksForEvaluation(evaluationId: string): Promise<ConditionEvidenceRegionRow[]> {
    const { data, error } = await this.client
      .from("condition_evidence_regions")
      .select("*")
      .eq("condition_evaluation_id", evaluationId);
    if (error) gatewayError("Failed to list evidence links.");
    return (data ?? []) as ConditionEvidenceRegionRow[];
  }

  async listEvaluationsForRegion(regionId: string, organizationId: string): Promise<ConditionEvidenceRegionRow[]> {
    const { data, error } = await this.client
      .from("condition_evidence_regions")
      .select("*")
      .eq("evidence_region_id", regionId)
      .eq("organization_id", organizationId);
    if (error) gatewayError("Failed to list evaluations for region.");
    return (data ?? []) as ConditionEvidenceRegionRow[];
  }

  async insertEvidenceLink(link: ConditionEvidenceRegionInsert): Promise<ConditionEvidenceRegionRow> {
    const { data, error } = await this.client.from("condition_evidence_regions").insert(link).select("*").single();
    if (error || !data) gatewayError("Failed to insert evidence link.");
    return data as ConditionEvidenceRegionRow;
  }

  async deleteEvidenceLink(linkId: string): Promise<void> {
    const { error } = await this.client.from("condition_evidence_regions").delete().eq("id", linkId);
    if (error) gatewayError("Failed to delete evidence link.");
  }

  async getFinding(findingId: string, projectId: string): Promise<FindingRow | null> {
    const { data, error } = await this.client
      .from("compliance_findings")
      .select("*")
      .eq("id", findingId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) gatewayError("Failed to load finding.");
    return (data as FindingRow | null) ?? null;
  }

  async updateFindingDerivedStatus(findingId: string, projectId: string, update: FindingStatusUpdate): Promise<void> {
    const { error } = await this.client
      .from("compliance_findings")
      .update({
        deterministic_derived_status: update.deterministicDerivedStatus as FindingRow["status"],
        status: update.finalStatus as FindingRow["status"],
        reasoning: update.reasoning
      })
      .eq("id", findingId)
      .eq("project_id", projectId);
    if (error) gatewayError("Failed to update finding status.");
  }

  async persistEvaluationAndRefreshParent(input: TransactionalPersistInput): Promise<TransactionalPersistResult> {
    const { data, error } = await this.client.rpc("persist_condition_evaluation_and_refresh_parent", {
      p_organization_id: input.organizationId,
      p_project_id: input.projectId,
      p_review_id: input.reviewId,
      p_finding_id: input.findingId,
      p_requirement_id: input.requirementId,
      p_requirement_condition_id: input.requirementConditionId,
      p_status: input.status,
      p_evidence_summary: input.evidenceSummary,
      p_reasoning: input.reasoning,
      p_contradiction_reasoning: input.contradictionReasoning,
      p_missing_information: input.missingInformation,
      p_verification_failure_reason: input.verificationFailureReason,
      p_contractor_action: input.contractorAction,
      p_confidence_score: input.confidenceScore,
      p_weightage_score: input.weightageScore,
      p_is_human_review_required: input.isHumanReviewRequired,
      p_evidence_links: input.evidenceLinks,
      p_deterministic_parent_status: input.deterministicParentStatus,
      p_deterministic_parent_reasoning: input.deterministicParentReasoning,
      p_deterministic_requires_human_review: input.deterministicRequiresHumanReview,
      p_created_by: input.createdBy
    });
    if (error) {
      const message = error.message ?? "Transaction failed.";
      if (message.includes("HUMAN_APPROVAL_PROTECTED")) {
        throw new HumanApprovalProtectedError();
      }
      if (message.includes("FINDING_NOT_FOUND")) {
        throw new FindingNotFoundError();
      }
      throw new Error(`TRANSACTION_FAILED: ${message}`);
    }
    const result = data as {
      evaluationId: string;
      parentStatus: string;
      deterministicStatus: string;
      humanOverridePreserved: boolean;
      revisionNumber: number;
    };
    return result;
  }

  async writeAudit(records: ComplianceAuditRecord[]): Promise<void> {
    if (records.length === 0) return;
    const { error } = await this.client.from("audit_logs").insert(
      records.map((record) => ({
        organization_id: record.organizationId,
        project_id: record.projectId,
        user_id: record.userId,
        action: record.action,
        entity_type: record.entityType,
        entity_id: record.entityId,
        metadata: record.metadata
      }))
    );
    if (error) gatewayError("Failed to write audit records.");
  }
}

export class HumanApprovalProtectedError extends Error {
  readonly code = "HUMAN_APPROVAL_PROTECTED" as const;
  constructor() {
    super("The existing evaluation has been reviewed by a human and cannot be superseded automatically.");
  }
}

export class FindingNotFoundError extends Error {
  readonly code = "FINDING_NOT_FOUND" as const;
  constructor() {
    super("The compliance finding was not found.");
  }
}
