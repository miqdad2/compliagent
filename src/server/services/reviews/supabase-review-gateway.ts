import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
import type { ReviewPersistenceGateway } from "./gateway";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export class SupabaseReviewGateway implements ReviewPersistenceGateway {
  constructor(private readonly db: AdminClient) {}

  async getReview(reviewId: string, organizationId: string): Promise<ReviewRow | null> {
    const { data, error } = await this.db
      .from("compliance_reviews")
      .select("*")
      .eq("id", reviewId)
      .maybeSingle();
    if (error || !data) return null;
    // Enforce org scope when organization_id is set on the row.
    if (data.organization_id !== null && data.organization_id !== organizationId) return null;
    return data as ReviewRow;
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
    const { data, error } = await this.db.rpc("begin_controlled_review", {
      p_organization_id:    organizationId,
      p_project_id:         projectId,
      p_review_id:          reviewId,
      p_review_version:     reviewVersion,
      p_source_hash:        sourceHash,
      p_extraction_version: extractionVersion,
      p_prompt_version:     promptVersion
    });
    if (error) throw new Error(error.message ?? "begin_controlled_review failed");
    const result = data as { reviewId: string; status: string; reviewVersion: number };
    return {
      reviewId: result.reviewId,
      organizationId,
      projectId,
      status: "running",
      reviewVersion: result.reviewVersion,
      sourceHash,
      extractionVersion,
      promptVersion
    };
  }

  async completeReviewToHumanReview(
    organizationId: string,
    reviewId: string,
    findingCount: number,
    conditionCount: number
  ): Promise<void> {
    const { error } = await this.db.rpc("complete_controlled_review_to_human_review", {
      p_organization_id: organizationId,
      p_review_id:       reviewId,
      p_finding_count:   findingCount,
      p_condition_count: conditionCount
    });
    if (error) throw new Error(error.message ?? "complete_controlled_review_to_human_review failed");
  }

  async failReview(
    organizationId: string,
    reviewId: string,
    errorCode: string,
    safeMessage: string
  ): Promise<void> {
    const { error } = await this.db.rpc("fail_controlled_review", {
      p_organization_id: organizationId,
      p_review_id:       reviewId,
      p_error_code:      errorCode,
      p_safe_message:    safeMessage
    });
    if (error) throw new Error(error.message ?? "fail_controlled_review failed");
  }

  async upsertFinding(input: FindingUpsertInput): Promise<string> {
    const { data, error } = await this.db.rpc("upsert_review_finding", {
      p_organization_id:   input.organizationId,
      p_project_id:        input.projectId,
      p_review_id:         input.reviewId,
      p_requirement_id:    input.requirementId,
      p_clause_number:     input.clauseNumber,
      p_sub_clause_number: input.subClauseNumber,
      p_requirement_text:  input.requirementText,
      p_status:            input.status,
      p_weightage_score:   input.weightageScore,
      p_confidence_score:  input.confidenceScore,
      p_reasoning:         input.reasoning,
      p_risk_level:        input.riskLevel,
      p_created_by:        input.createdBy
    });
    if (error || !data) throw new Error(error?.message ?? "upsert_review_finding failed");
    return (data as { findingId: string }).findingId;
  }

  async updateFindingStatus(
    findingId: string,
    _organizationId: string,
    deterministicStatus: string,
    finalStatus: string,
    reasoning: string
  ): Promise<void> {
    const { error } = await this.db
      .from("compliance_findings")
      .update({
        deterministic_derived_status: deterministicStatus as FindingRow["deterministic_derived_status"],
        status: finalStatus as FindingRow["status"],
        reasoning,
        updated_at: new Date().toISOString()
      })
      .eq("id", findingId);
    if (error) throw new Error(error.message);
  }

  async listRequirementsForProject(projectId: string, _organizationId: string): Promise<RequirementRow[]> {
    const { data, error } = await this.db
      .from("extracted_requirements")
      .select("*")
      .eq("project_id", projectId)
      .order("clause_number", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RequirementRow[];
  }

  async listChunksForDocuments(documentIds: string[], projectId: string): Promise<ChunkRow[]> {
    if (documentIds.length === 0) return [];
    const { data, error } = await this.db
      .from("document_chunks")
      .select("*")
      .in("document_id", documentIds)
      .eq("project_id", projectId)
      .order("page_number", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ChunkRow[];
  }

  async listEvidenceRegionsForDocuments(
    documentIds: string[],
    organizationId: string,
    projectId: string
  ): Promise<EvidenceRegionRow[]> {
    if (documentIds.length === 0) return [];
    const { data, error } = await this.db
      .from("evidence_regions")
      .select("*")
      .in("document_id", documentIds)
      .eq("organization_id", organizationId)
      .eq("project_id", projectId);
    if (error) throw new Error(error.message);
    return (data ?? []) as EvidenceRegionRow[];
  }

  async listFindingsForReview(reviewId: string, _organizationId: string): Promise<FindingRow[]> {
    const { data, error } = await this.db
      .from("compliance_findings")
      .select("*")
      .eq("review_id", reviewId);
    if (error) throw new Error(error.message);
    return (data ?? []) as FindingRow[];
  }

  async listProjectDocuments(
    projectId: string,
    _organizationId: string
  ): Promise<Array<{ id: string; document_role: string; processing_status: string }>> {
    const { data, error } = await this.db
      .from("documents")
      .select("id, document_role, processing_status")
      .eq("project_id", projectId);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ id: string; document_role: string; processing_status: string }>;
  }

  async writeAudit(records: ReviewAuditRecord[]): Promise<void> {
    if (records.length === 0) return;
    const { error } = await this.db.from("audit_logs").insert(
      records.map((r) => ({
        organization_id: r.organizationId,
        project_id:      r.projectId,
        user_id:         r.userId,
        action:          r.action,
        entity_type:     r.entityType,
        entity_id:       r.entityId,
        metadata:        r.metadata
      }))
    );
    if (error) throw new Error(error.message);
  }
}
