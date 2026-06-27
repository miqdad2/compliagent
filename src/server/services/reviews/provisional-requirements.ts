/**
 * ProvisionalRequirementService — persists requirements discovered at runtime
 * (from chunk scanning) that do not yet have a stored extracted_requirements row.
 *
 * Requirement states:
 *   discovered  — identified by mandatory-language scan, not yet confirmed
 *   provisional — AI refinement improved/validated it; needs human confirmation
 *   confirmed   — human has approved; safe to use in approved findings
 *   rejected    — human has rejected; kept for audit; excluded from pipeline
 *   superseded  — replaced by a newer version; kept for audit
 *
 * Rules enforced here:
 * - Exact source grounding (requirementText) is mandatory.
 * - Human-confirmed requirements are never overwritten by reruns.
 * - Duplicate active requirements (same source_document_id + page + clause) are prevented.
 * - Rejected requirements stay in the DB with is_active=false.
 */
import type { Database } from "@/types/database";
import type { ReviewAuditRecord } from "./types";

export type ProvisionalRequirementInsert = {
  organizationId:       string;
  projectId:            string;
  reviewId:             string;
  sourceDocumentId:     string;
  pageNumber:           number;
  clauseNumber:         string | null;
  subClauseNumber:      string | null;
  sectionHeading:       string | null;
  requirementText:      string;
  normalizedText:       string | null;
  requirementType:      string | null;
  mandatoryLevel:       string | null;
  requirementState:     "discovered" | "provisional" | "confirmed";
  discoveryConfidence:  number;
  refinementConfidence: number | null;
  aiRunId:              string | null;
  promptVersion:        string | null;
  humanReviewRequired:  boolean;
  humanReviewReasons:   string[];
  createdBy:            string;
};

export type ProvisionalRequirementRow =
  Database["public"]["Tables"]["extracted_requirements"]["Row"];

export type PersistedRequirement = {
  id:             string;
  isNew:          boolean;
  state:          string;
  humanConfirmed: boolean;
};

export type ConfirmRequirementInput = {
  requirementId:  string;
  organizationId: string;
  projectId:      string;
  reviewId:       string;
  reviewerId:     string;
  /** Optional updated text if the reviewer edits the normalized requirement. */
  normalizedText?: string;
};

export type RejectRequirementInput = {
  requirementId:  string;
  organizationId: string;
  projectId:      string;
  reviewId:       string;
  reviewerId:     string;
  reason:         string;
};

export interface ProvisionalRequirementGateway {
  /** Find an existing active provisional requirement for the same source location. */
  findExisting(
    projectId: string,
    sourceDocumentId: string,
    pageNumber: number,
    clauseNumber: string | null
  ): Promise<ProvisionalRequirementRow | null>;

  /** Insert a new provisional requirement row. */
  insert(row: ProvisionalRequirementInsert): Promise<ProvisionalRequirementRow>;

  /** Get a single requirement by ID, scoped to org. */
  get(requirementId: string, organizationId: string): Promise<ProvisionalRequirementRow | null>;

  /** Update requirement state (confirm/reject/supersede). */
  setState(
    requirementId:  string,
    organizationId: string,
    state:          string,
    normalizedText?: string | null,
    supersededReason?: string | null
  ): Promise<ProvisionalRequirementRow | null>;

  /** List all active requirements for a project. */
  listActive(projectId: string, organizationId: string): Promise<ProvisionalRequirementRow[]>;

  /** List all requirements linked to a review. */
  listForReview(reviewId: string, organizationId: string): Promise<ProvisionalRequirementRow[]>;

  /** Write audit records. */
  writeAudit(records: ReviewAuditRecord[]): Promise<void>;
}

const PROVISIONAL_AUDIT_ACTIONS = {
  REQUIREMENT_DISCOVERED:  "provisional_requirement.discovered",
  REQUIREMENT_CONFIRMED:   "provisional_requirement.confirmed",
  REQUIREMENT_REJECTED:    "provisional_requirement.rejected",
  REQUIREMENT_DUPLICATE:   "provisional_requirement.duplicate_skipped",
  HUMAN_PROTECTED:         "provisional_requirement.human_confirmed_protected"
} as const;

export class ProvisionalRequirementService {
  constructor(private readonly gateway: ProvisionalRequirementGateway) {}

  /**
   * Persist a provisional requirement discovered at runtime.
   * Idempotent: if an active requirement already exists for the same
   * source location, returns the existing one without overwriting it.
   * If the existing row is human-confirmed, it is never overwritten.
   */
  async persistDiscovered(
    input: ProvisionalRequirementInsert
  ): Promise<PersistedRequirement> {
    if (!input.requirementText.trim()) {
      throw new Error("requirementText must not be empty — exact source grounding is required.");
    }

    // Check for existing active requirement at this source location.
    const existing = await this.gateway.findExisting(
      input.projectId,
      input.sourceDocumentId,
      input.pageNumber,
      input.clauseNumber
    );

    if (existing) {
      // Human-confirmed: never overwrite.
      if (existing.requirement_state === "confirmed") {
        await this.gateway.writeAudit([{
          organizationId: input.organizationId,
          projectId:      input.projectId,
          userId:         input.createdBy,
          action:         PROVISIONAL_AUDIT_ACTIONS.HUMAN_PROTECTED,
          entityType:     "extracted_requirements",
          entityId:       existing.id,
          metadata:       { sourceDocumentId: input.sourceDocumentId, pageNumber: input.pageNumber }
        }]);
        return { id: existing.id, isNew: false, state: existing.requirement_state, humanConfirmed: true };
      }

      // Existing provisional/discovered: skip duplicate.
      await this.gateway.writeAudit([{
        organizationId: input.organizationId,
        projectId:      input.projectId,
        userId:         input.createdBy,
        action:         PROVISIONAL_AUDIT_ACTIONS.REQUIREMENT_DUPLICATE,
        entityType:     "extracted_requirements",
        entityId:       existing.id,
        metadata:       { sourceDocumentId: input.sourceDocumentId, clauseNumber: input.clauseNumber }
      }]);
      return { id: existing.id, isNew: false, state: existing.requirement_state, humanConfirmed: false };
    }

    // Insert new provisional requirement.
    const row = await this.gateway.insert(input);

    await this.gateway.writeAudit([{
      organizationId: input.organizationId,
      projectId:      input.projectId,
      userId:         input.createdBy,
      action:         PROVISIONAL_AUDIT_ACTIONS.REQUIREMENT_DISCOVERED,
      entityType:     "extracted_requirements",
      entityId:       row.id,
      metadata: {
        state:               input.requirementState,
        discoveryConfidence: input.discoveryConfidence,
        humanReviewRequired: input.humanReviewRequired,
        reasonCount:         input.humanReviewReasons.length
      }
    }]);

    return { id: row.id, isNew: true, state: input.requirementState, humanConfirmed: false };
  }

  /** Human reviewer confirms a provisional requirement. */
  async confirm(input: ConfirmRequirementInput): Promise<ProvisionalRequirementRow> {
    const existing = await this.gateway.get(input.requirementId, input.organizationId);
    if (!existing) throw new Error(`Requirement ${input.requirementId} not found or not accessible.`);
    if (existing.project_id !== input.projectId) throw new Error("Project access denied.");
    if (existing.requirement_state === "confirmed") {
      return existing; // Already confirmed; idempotent.
    }

    const updated = await this.gateway.setState(
      input.requirementId,
      input.organizationId,
      "confirmed",
      input.normalizedText ?? null
    );

    await this.gateway.writeAudit([{
      organizationId: input.organizationId,
      projectId:      input.projectId,
      userId:         input.reviewerId,
      action:         PROVISIONAL_AUDIT_ACTIONS.REQUIREMENT_CONFIRMED,
      entityType:     "extracted_requirements",
      entityId:       input.requirementId,
      metadata:       { priorState: existing.requirement_state }
    }]);

    return updated!;
  }

  /** Human reviewer rejects a provisional requirement. */
  async reject(input: RejectRequirementInput): Promise<ProvisionalRequirementRow> {
    const existing = await this.gateway.get(input.requirementId, input.organizationId);
    if (!existing) throw new Error(`Requirement ${input.requirementId} not found or not accessible.`);
    if (existing.project_id !== input.projectId) throw new Error("Project access denied.");
    if (existing.requirement_state === "confirmed") {
      throw new Error("Cannot reject a human-confirmed requirement. Use supersede instead.");
    }

    const updated = await this.gateway.setState(
      input.requirementId,
      input.organizationId,
      "rejected",
      null,
      input.reason
    );

    await this.gateway.writeAudit([{
      organizationId: input.organizationId,
      projectId:      input.projectId,
      userId:         input.reviewerId,
      action:         PROVISIONAL_AUDIT_ACTIONS.REQUIREMENT_REJECTED,
      entityType:     "extracted_requirements",
      entityId:       input.requirementId,
      metadata:       { priorState: existing.requirement_state }
    }]);

    return updated!;
  }
}
