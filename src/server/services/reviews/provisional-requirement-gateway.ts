/**
 * Supabase and in-memory implementations of ProvisionalRequirementGateway.
 * The memory implementation is used in unit tests; no database dependency.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ReviewAuditRecord } from "./types";
import type {
  ProvisionalRequirementGateway,
  ProvisionalRequirementInsert,
  ProvisionalRequirementRow
} from "./provisional-requirements";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

// ── Supabase implementation ───────────────────────────────────────────────────

export class SupabaseProvisionalRequirementGateway implements ProvisionalRequirementGateway {
  constructor(private readonly db: AdminClient) {}

  async findExisting(
    projectId: string,
    sourceDocumentId: string,
    pageNumber: number,
    clauseNumber: string | null
  ): Promise<ProvisionalRequirementRow | null> {
    let query = this.db
      .from("extracted_requirements")
      .select("*")
      .eq("project_id", projectId)
      .eq("source_document_id", sourceDocumentId)
      .eq("page_number", pageNumber)
      .eq("is_active", true)
      .neq("requirement_state", "rejected")
      .neq("requirement_state", "superseded");

    if (clauseNumber !== null) {
      query = query.eq("clause_number", clauseNumber);
    } else {
      query = query.is("clause_number", null);
    }

    const { data } = await query.maybeSingle();
    return (data as ProvisionalRequirementRow | null) ?? null;
  }

  async insert(row: ProvisionalRequirementInsert): Promise<ProvisionalRequirementRow> {
    const { data, error } = await this.db
      .from("extracted_requirements")
      .insert({
        organization_id:       row.organizationId,
        project_id:            row.projectId,
        review_id:             row.reviewId,
        source_document_id:    row.sourceDocumentId,
        page_number:           row.pageNumber,
        clause_number:         row.clauseNumber,
        sub_clause_number:     row.subClauseNumber,
        section_heading:       row.sectionHeading,
        requirement_text:      row.requirementText,
        normalized_text:       row.normalizedText,
        requirement_type:      row.requirementType,
        mandatory_level:       row.mandatoryLevel,
        requirement_state:     row.requirementState,
        extraction_confidence: row.discoveryConfidence,
        discovery_confidence:  row.discoveryConfidence,
        refinement_confidence: row.refinementConfidence,
        ai_run_id:             row.aiRunId,
        prompt_version:        row.promptVersion,
        human_review_required: row.humanReviewRequired,
        human_review_reasons:  row.humanReviewReasons,
        created_by:            row.createdBy,
        is_active:             true
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Failed to insert provisional requirement.");
    return data as ProvisionalRequirementRow;
  }

  async get(requirementId: string, organizationId: string): Promise<ProvisionalRequirementRow | null> {
    const { data } = await this.db
      .from("extracted_requirements")
      .select("*")
      .eq("id", requirementId)
      .maybeSingle();
    if (!data) return null;
    const row = data as ProvisionalRequirementRow;
    if (row.organization_id !== null && row.organization_id !== organizationId) return null;
    return row;
  }

  async setState(
    requirementId: string,
    _organizationId: string,
    state: string,
    normalizedText?: string | null,
    supersededReason?: string | null
  ): Promise<ProvisionalRequirementRow | null> {
    const update: Record<string, unknown> = {
      requirement_state: state,
      is_active:         state !== "rejected" && state !== "superseded",
      updated_at:        new Date().toISOString()
    };
    if (normalizedText !== undefined && normalizedText !== null) {
      update.normalized_text = normalizedText;
    }
    if (supersededReason) {
      update.superseded_reason = supersededReason;
      update.superseded_at     = new Date().toISOString();
    }
    const { data } = await this.db
      .from("extracted_requirements")
      .update(update)
      .eq("id", requirementId)
      .select("*")
      .maybeSingle();
    return (data as ProvisionalRequirementRow | null) ?? null;
  }

  async listActive(projectId: string, organizationId: string): Promise<ProvisionalRequirementRow[]> {
    const { data, error } = await this.db
      .from("extracted_requirements")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("clause_number", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ProvisionalRequirementRow[];
    return rows.filter((r) => r.organization_id === null || r.organization_id === organizationId);
  }

  async listForReview(reviewId: string, organizationId: string): Promise<ProvisionalRequirementRow[]> {
    const { data, error } = await this.db
      .from("extracted_requirements")
      .select("*")
      .eq("review_id", reviewId)
      .eq("is_active", true)
      .order("page_number", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ProvisionalRequirementRow[];
    return rows.filter((r) => r.organization_id === null || r.organization_id === organizationId);
  }

  async writeAudit(records: ReviewAuditRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db.from("audit_logs").insert(
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
  }
}

// ── In-memory implementation for tests ───────────────────────────────────────

export class MemoryProvisionalRequirementGateway implements ProvisionalRequirementGateway {
  readonly rows: ProvisionalRequirementRow[] = [];
  readonly audits: ReviewAuditRecord[] = [];
  private nextId = 1;

  async findExisting(
    projectId: string,
    sourceDocumentId: string,
    pageNumber: number,
    clauseNumber: string | null
  ): Promise<ProvisionalRequirementRow | null> {
    return (
      this.rows.find(
        (r) =>
          r.project_id === projectId &&
          r.source_document_id === sourceDocumentId &&
          r.page_number === pageNumber &&
          r.clause_number === clauseNumber &&
          r.is_active &&
          r.requirement_state !== "rejected" &&
          r.requirement_state !== "superseded"
      ) ?? null
    );
  }

  async insert(row: ProvisionalRequirementInsert): Promise<ProvisionalRequirementRow> {
    const now = new Date().toISOString();
    const newRow: ProvisionalRequirementRow = {
      id:                    `req-${this.nextId++}`,
      organization_id:       row.organizationId,
      project_id:            row.projectId,
      review_id:             row.reviewId,
      source_document_id:    row.sourceDocumentId,
      page_number:           row.pageNumber,
      clause_number:         row.clauseNumber,
      sub_clause_number:     row.subClauseNumber,
      section_heading:       row.sectionHeading,
      requirement_text:      row.requirementText,
      normalized_text:       row.normalizedText,
      requirement_type:      row.requirementType,
      requirement_state:     row.requirementState,
      discipline:            null,
      mandatory_level:       row.mandatoryLevel,
      numeric_value:         null,
      unit:                  null,
      standard_reference:    null,
      acceptance_criteria:   null,
      extraction_confidence: row.discoveryConfidence,
      discovery_confidence:  row.discoveryConfidence,
      refinement_confidence: row.refinementConfidence,
      ai_run_id:             row.aiRunId,
      prompt_version:        row.promptVersion,
      human_review_required: row.humanReviewRequired,
      human_review_reasons:  row.humanReviewReasons,
      is_active:             true,
      superseded_at:         null,
      superseded_reason:     null,
      created_by:            row.createdBy,
      created_at:            now,
      updated_at:            now
    };
    this.rows.push(newRow);
    return newRow;
  }

  async get(requirementId: string, organizationId: string): Promise<ProvisionalRequirementRow | null> {
    const row = this.rows.find((r) => r.id === requirementId);
    if (!row) return null;
    if (row.organization_id !== null && row.organization_id !== organizationId) return null;
    return row;
  }

  async setState(
    requirementId: string,
    _organizationId: string,
    state: string,
    normalizedText?: string | null,
    supersededReason?: string | null
  ): Promise<ProvisionalRequirementRow | null> {
    const row = this.rows.find((r) => r.id === requirementId);
    if (!row) return null;
    row.requirement_state = state;
    row.is_active = state !== "rejected" && state !== "superseded";
    if (normalizedText !== undefined && normalizedText !== null) row.normalized_text = normalizedText;
    if (supersededReason) {
      row.superseded_reason = supersededReason;
      row.superseded_at     = new Date().toISOString();
    }
    row.updated_at = new Date().toISOString();
    return row;
  }

  async listActive(projectId: string, _organizationId: string): Promise<ProvisionalRequirementRow[]> {
    return this.rows.filter((r) => r.project_id === projectId && r.is_active);
  }

  async listForReview(reviewId: string, _organizationId: string): Promise<ProvisionalRequirementRow[]> {
    return this.rows.filter((r) => r.review_id === reviewId && r.is_active);
  }

  async writeAudit(records: ReviewAuditRecord[]): Promise<void> {
    this.audits.push(...records);
  }
}
