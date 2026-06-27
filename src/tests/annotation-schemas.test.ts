import { describe, expect, it } from "vitest";
import {
  annotationApprovalSchema,
  annotationApprovalStatusSchema,
  annotationRevisionSchema,
  annotationStatusSchema,
  annotationTypeSchema,
  conditionAnnotationContentSchema,
  documentAnnotationSchema,
  evidenceRegionSchema,
  regionCoordinatesSchema
} from "@/lib/annotations/schemas";
import { assertOrganizationOwnership, belongsToOrganization } from "@/lib/annotations/ownership";

const ids = {
  annotation: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  document: "44444444-4444-4444-8444-444444444444",
  review: "55555555-5555-4555-8555-555555555555",
  finding: "66666666-6666-4666-8666-666666666666",
  region: "77777777-7777-4777-8777-777777777777",
  profile: "88888888-8888-4888-8888-888888888888",
  revision: "99999999-9999-4999-8999-999999999999",
  approval: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
};

const timestamp = "2026-06-20T12:00:00.000Z";

describe("annotation schemas", () => {
  it("validates a source-traceable evidence region", () => {
    const result = evidenceRegionSchema.parse({
      id: ids.region,
      organizationId: ids.organization,
      projectId: ids.project,
      documentId: ids.document,
      pageNumber: 3,
      slideNumber: null,
      sheetName: null,
      cellRange: null,
      regionType: "table",
      coordinateSystem: "normalized",
      x: 0.1,
      y: 0.2,
      width: 0.6,
      height: 0.3,
      extractedText: "Ingress protection: IP55",
      extractionConfidence: 0.94,
      sourceHash: "sha256:source-region",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(result.regionType).toBe("table");
    expect(result.extractionConfidence).toBe(0.94);
  });

  it("validates a complete annotation and its revision payload", () => {
    const annotation = documentAnnotationSchema.parse({
      id: ids.annotation,
      organizationId: ids.organization,
      projectId: ids.project,
      reviewId: ids.review,
      findingId: ids.finding,
      documentId: ids.document,
      evidenceRegionId: ids.region,
      pageNumber: 3,
      annotationType: "callout",
      status: "draft",
      label: "PARTIALLY COMPLIED",
      comment: "Evidence does not state the test condition.",
      sourceReference: "Specification 7.2",
      clauseNumber: "7.2",
      subClauseNumber: null,
      complianceStatus: "partially_complied",
      reasoning: "The submitted value is present but its measurement condition is missing.",
      missingInformation: "Submit the measurement condition.",
      contractorAction: "Provide a revised certified datasheet.",
      coordinateSystem: "normalized",
      x: 0.65,
      y: 0.2,
      width: 0.3,
      height: 0.25,
      connectorTargetRegionId: ids.region,
      styleMetadata: {},
      isAiGenerated: true,
      createdBy: ids.profile,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const revision = annotationRevisionSchema.parse({
      id: ids.revision,
      annotationId: ids.annotation,
      organizationId: ids.organization,
      projectId: ids.project,
      revisionNumber: 1,
      previousPayload: { comment: "Original" },
      newPayload: { comment: annotation.comment },
      changedBy: ids.profile,
      changedAt: timestamp
    });

    expect(annotation.findingId).toBe(ids.finding);
    expect(annotation.evidenceRegionId).toBe(ids.region);
    expect(revision.revisionNumber).toBe(1);
  });

  it("rejects invalid and out-of-bounds coordinates", () => {
    expect(
      regionCoordinatesSchema.safeParse({
        coordinateSystem: "normalized",
        x: 0.8,
        y: 0.2,
        width: 0.3,
        height: 0.2
      }).success
    ).toBe(false);

    expect(
      regionCoordinatesSchema.safeParse({
        coordinateSystem: "pdf_points",
        x: 10,
        y: 10,
        width: 0,
        height: 20
      }).success
    ).toBe(false);
  });

  it("accepts only defined annotation and approval statuses", () => {
    expect(annotationStatusSchema.safeParse("pending_review").success).toBe(true);
    expect(annotationStatusSchema.safeParse("published").success).toBe(false);
    expect(annotationApprovalStatusSchema.safeParse("approved").success).toBe(true);
    expect(annotationApprovalStatusSchema.safeParse("accepted").success).toBe(false);
    expect(annotationTypeSchema.safeParse("cloud").success).toBe(true);
  });

  it("validates condition-level annotation content for exact evidence", () => {
    const content = conditionAnnotationContentSchema.parse({
      sourceRequirementDocumentId: ids.document,
      clauseNumber: "2.2.1",
      subClauseNumber: "A.1(b)",
      parentFindingStatus: "partially_complied",
      requirementConditionId: ids.revision,
      conditionEvaluationId: ids.approval,
      matchedCondition: "Driver size must be between 3.5 and 4 inches.",
      exactEvidenceText: '3.5" drivers',
      conciseResult: "Driver size is proven.",
      missingCondition: "Full-range construction and neodymium magnets are not proven.",
      contractorAction: "Provide a manufacturer datasheet confirming the missing conditions.",
      evidenceRegionId: ids.region,
      approvalStatus: "pending"
    });

    expect(content.exactEvidenceText).toBe('3.5" drivers');
    expect(content.parentFindingStatus).toBe("partially_complied");
  });

  it("requires reviewer identity and time for a final approval decision", () => {
    expect(
      annotationApprovalSchema.safeParse({
        id: ids.approval,
        annotationId: ids.annotation,
        organizationId: ids.organization,
        projectId: ids.project,
        approvalStatus: "approved",
        reviewerId: null,
        reviewerComment: null,
        reviewedAt: null
      }).success
    ).toBe(false);
  });
});

describe("annotation organization ownership", () => {
  it("allows only the active organization", () => {
    const record = { organizationId: ids.organization };

    expect(belongsToOrganization(record, ids.organization)).toBe(true);
    expect(belongsToOrganization(record, ids.project)).toBe(false);
    expect(() => assertOrganizationOwnership(record, ids.project)).toThrow("active organization");
  });
});
