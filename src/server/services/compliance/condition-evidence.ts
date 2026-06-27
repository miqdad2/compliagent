import type { ConditionEvidenceRelationship } from "@/lib/compliance/condition-schemas";
import { conditionEvidenceRelationshipTypeSchema } from "@/lib/compliance/condition-schemas";
import { ok, fail, type ServiceResult } from "./types";
import type { CompliancePersistenceGateway, ConditionEvidenceRegionRow } from "./gateway";

export type LinkEvidenceInput = {
  conditionEvaluationId: string;
  evidenceRegionId: string | null;
  organizationId: string;
  projectId: string;
  relationshipType: ConditionEvidenceRelationship;
  requestingUserId: string;
};

export const EVIDENCE_AUDIT_ACTIONS = {
  EVIDENCE_LINKED: "condition_evidence.linked",
  EVIDENCE_UNLINKED: "condition_evidence.unlinked"
} as const;

const VALID_RELATIONSHIP_TYPES = new Set<ConditionEvidenceRelationship>([
  "supports",
  "contradicts",
  "partially_supports",
  "contextual",
  "missing_expected_region"
]);

export class ConditionEvidenceService {
  constructor(private readonly gateway: CompliancePersistenceGateway) {}

  async linkEvidenceRegion(input: LinkEvidenceInput): Promise<ServiceResult<ConditionEvidenceRegionRow>> {
    const parsed = conditionEvidenceRelationshipTypeSchema.safeParse(input.relationshipType);
    if (!parsed.success) {
      return fail("INVALID_EVALUATION", `Invalid relationship type: ${input.relationshipType}.`);
    }

    const isMissingMarker = input.relationshipType === "missing_expected_region";

    if (isMissingMarker && input.evidenceRegionId !== null) {
      return fail("INVALID_EVALUATION", "missing_expected_region links must not reference an evidence region.");
    }
    if (!isMissingMarker && input.evidenceRegionId === null) {
      return fail("INVALID_EVALUATION", "Evidence links other than missing_expected_region require an evidence region.");
    }

    if (!isMissingMarker && input.evidenceRegionId !== null) {
      const regionScope = await this.gateway.getEvidenceRegionScope(input.evidenceRegionId);
      if (!regionScope) {
        return fail("EVIDENCE_REGION_NOT_FOUND", "The evidence region was not found.");
      }
      if (regionScope.organizationId !== input.organizationId) {
        return fail("CROSS_ORGANIZATION_LINK_DENIED", "The evidence region belongs to a different organization.");
      }
      if (regionScope.projectId !== input.projectId) {
        return fail("CROSS_PROJECT_LINK_DENIED", "The evidence region belongs to a different project.");
      }

      const existing = await this.gateway.listEvidenceLinksForEvaluation(input.conditionEvaluationId);
      const duplicate = existing.find((link) => link.evidence_region_id === input.evidenceRegionId);
      if (duplicate) {
        return fail("DUPLICATE_EVIDENCE_LINK", "This evidence region is already linked to this evaluation.");
      }
    }

    const row = await this.gateway.insertEvidenceLink({
      condition_evaluation_id: input.conditionEvaluationId,
      evidence_region_id: input.evidenceRegionId,
      organization_id: input.organizationId,
      project_id: input.projectId,
      relationship_type: input.relationshipType
    });

    await this.gateway.writeAudit([
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.requestingUserId,
        action: EVIDENCE_AUDIT_ACTIONS.EVIDENCE_LINKED,
        entityType: "condition_evidence_regions",
        entityId: row.id,
        metadata: {
          evaluationId: input.conditionEvaluationId,
          relationshipType: input.relationshipType
        }
      }
    ]);

    return ok(row);
  }

  async removeUnapprovedDraftLink(
    linkId: string,
    organizationId: string,
    projectId: string,
    requestingUserId: string
  ): Promise<ServiceResult<void>> {
    const existing = await this.gateway.listEvidenceLinksForEvaluation(linkId);
    const link = existing.find((l) => l.id === linkId);
    if (!link) {
      const allLinks = await this.gateway.listEvaluationsForRegion(linkId, organizationId);
      const found = allLinks.find((l) => l.id === linkId);
      if (!found) {
        return fail("EVALUATION_NOT_FOUND", "The evidence link was not found.");
      }
      if (found.organization_id !== organizationId) {
        return fail("ORGANIZATION_ACCESS_DENIED", "Access denied.");
      }
      await this.gateway.deleteEvidenceLink(linkId);
    } else {
      if (link.organization_id !== organizationId) {
        return fail("ORGANIZATION_ACCESS_DENIED", "Access denied.");
      }
      await this.gateway.deleteEvidenceLink(linkId);
    }

    await this.gateway.writeAudit([
      {
        organizationId,
        projectId,
        userId: requestingUserId,
        action: EVIDENCE_AUDIT_ACTIONS.EVIDENCE_UNLINKED,
        entityType: "condition_evidence_regions",
        entityId: linkId,
        metadata: {}
      }
    ]);

    return ok(undefined);
  }

  async listForEvaluation(
    evaluationId: string,
    organizationId: string
  ): Promise<ServiceResult<ConditionEvidenceRegionRow[]>> {
    const rows = await this.gateway.listEvidenceLinksForEvaluation(evaluationId);
    const filtered = rows.filter((r) => r.organization_id === organizationId);
    return ok(filtered);
  }

  async listEvaluationsByRegion(
    regionId: string,
    organizationId: string
  ): Promise<ServiceResult<ConditionEvidenceRegionRow[]>> {
    const rows = await this.gateway.listEvaluationsForRegion(regionId, organizationId);
    return ok(rows);
  }

  isValidRelationshipType(type: string): type is ConditionEvidenceRelationship {
    return VALID_RELATIONSHIP_TYPES.has(type as ConditionEvidenceRelationship);
  }
}
