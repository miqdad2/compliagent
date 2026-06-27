import { z } from "zod";
import { complianceStatuses } from "@/types/domain";

export const evidenceRegionTypes = ["text", "table", "image", "diagram", "cell", "signature", "stamp", "other"] as const;
export const coordinateSystems = ["normalized", "pdf_points", "pixels", "spreadsheet_cells", "slide_emu"] as const;
export const findingEvidenceRelationshipTypes = ["supports", "contradicts", "context"] as const;
export const annotationTypes = ["highlight", "callout", "connector", "evidence_marker", "outline", "cloud"] as const;
export const annotationStatuses = ["draft", "pending_review", "approved", "rejected", "deleted"] as const;
export const annotationApprovalStatuses = ["pending", "approved", "rejected"] as const;

export const evidenceRegionTypeSchema = z.enum(evidenceRegionTypes);
export const coordinateSystemSchema = z.enum(coordinateSystems);
export const findingEvidenceRelationshipTypeSchema = z.enum(findingEvidenceRelationshipTypes);
export const annotationTypeSchema = z.enum(annotationTypes);
export const annotationStatusSchema = z.enum(annotationStatuses);
export const annotationApprovalStatusSchema = z.enum(annotationApprovalStatuses);

const nullableCoordinateSchema = z.number().finite().nullable();

export const regionCoordinatesSchema = z
  .object({
    coordinateSystem: coordinateSystemSchema,
    x: nullableCoordinateSchema,
    y: nullableCoordinateSchema,
    width: nullableCoordinateSchema,
    height: nullableCoordinateSchema
  })
  .superRefine((coordinates, context) => {
    const values = [coordinates.x, coordinates.y, coordinates.width, coordinates.height];
    const allNull = values.every((value) => value === null);
    const allNumbers = values.every((value) => value !== null);

    if (allNull) {
      if (coordinates.coordinateSystem !== "spreadsheet_cells") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Coordinates may be omitted only for spreadsheet cell regions."
        });
      }
      return;
    }

    if (!allNumbers) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "x, y, width, and height must be provided together."
      });
      return;
    }

    const { x, y, width, height } = coordinates as {
      x: number;
      y: number;
      width: number;
      height: number;
    };

    if (x < 0 || y < 0 || width <= 0 || height <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Coordinates require non-negative origins and positive dimensions."
      });
    }

    if (
      coordinates.coordinateSystem === "normalized" &&
      (x > 1 || y > 1 || width > 1 || height > 1 || x + width > 1 || y + height > 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Normalized coordinates must fit within the unit document boundary."
      });
    }
  });

export const evidenceRegionSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    documentId: z.string().uuid(),
    pageNumber: z.number().int().positive().nullable(),
    slideNumber: z.number().int().positive().nullable(),
    sheetName: z.string().trim().min(1).nullable(),
    cellRange: z.string().trim().min(1).nullable(),
    regionType: evidenceRegionTypeSchema,
    extractedText: z.string().nullable(),
    extractionConfidence: z.number().min(0).max(1),
    sourceHash: z.string().trim().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .and(regionCoordinatesSchema)
  .superRefine((region, context) => {
    if (region.pageNumber === null && region.slideNumber === null && region.sheetName === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An evidence region requires a page, slide, or sheet locator."
      });
    }

    if (region.coordinateSystem === "spreadsheet_cells" && (!region.sheetName || !region.cellRange)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Spreadsheet regions require both sheetName and cellRange."
      });
    }
  });

export const findingEvidenceRegionSchema = z.object({
  findingId: z.string().uuid(),
  evidenceRegionId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  relationshipType: findingEvidenceRelationshipTypeSchema,
  createdAt: z.string().datetime()
});

const annotationCoordinatesSchema = regionCoordinatesSchema.superRefine((coordinates, context) => {
  if ([coordinates.x, coordinates.y, coordinates.width, coordinates.height].some((value) => value === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Annotations require explicit x, y, width, and height coordinates."
    });
  }
});

export const documentAnnotationSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    reviewId: z.string().uuid(),
    findingId: z.string().uuid(),
    documentId: z.string().uuid(),
    evidenceRegionId: z.string().uuid(),
    sourceRequirementDocumentId: z.string().uuid().nullable().default(null),
    requirementConditionId: z.string().uuid().nullable().default(null),
    conditionEvaluationId: z.string().uuid().nullable().default(null),
    pageNumber: z.number().int().positive(),
    annotationType: annotationTypeSchema,
    status: annotationStatusSchema,
    label: z.string().trim().min(1),
    comment: z.string().nullable(),
    sourceReference: z.string().trim().min(1),
    clauseNumber: z.string().nullable(),
    subClauseNumber: z.string().nullable(),
    complianceStatus: z.enum(complianceStatuses),
    matchedCondition: z.string().trim().min(1).nullable().default(null),
    exactEvidenceText: z.string().trim().min(1).nullable().default(null),
    conciseResult: z.string().trim().min(1).nullable().default(null),
    reasoning: z.string().trim().min(1),
    missingInformation: z.string().nullable(),
    contractorAction: z.string().nullable(),
    connectorTargetRegionId: z.string().uuid().nullable(),
    styleMetadata: z.record(z.unknown()),
    isAiGenerated: z.boolean(),
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .and(annotationCoordinatesSchema)
  .superRefine((annotation, context) => {
    const conditionFields = [
      annotation.sourceRequirementDocumentId,
      annotation.requirementConditionId,
      annotation.conditionEvaluationId,
      annotation.matchedCondition,
      annotation.exactEvidenceText,
      annotation.conciseResult
    ];
    const populatedFields = conditionFields.filter((value) => value !== null).length;

    if (populatedFields > 0 && populatedFields !== conditionFields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Condition-level annotations require complete requirement, evaluation, evidence, and result content."
      });
    }
  });

export const conditionAnnotationContentSchema = z.object({
  sourceRequirementDocumentId: z.string().uuid(),
  clauseNumber: z.string().trim().min(1),
  subClauseNumber: z.string().trim().min(1).nullable(),
  parentFindingStatus: z.enum(complianceStatuses),
  requirementConditionId: z.string().uuid(),
  conditionEvaluationId: z.string().uuid(),
  matchedCondition: z.string().trim().min(1),
  exactEvidenceText: z.string().trim().min(1),
  conciseResult: z.string().trim().min(1),
  missingCondition: z.string().trim().min(1).nullable(),
  contractorAction: z.string().trim().min(1).nullable(),
  evidenceRegionId: z.string().uuid(),
  approvalStatus: annotationApprovalStatusSchema
});

export const annotationRevisionSchema = z.object({
  id: z.string().uuid(),
  annotationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  previousPayload: z.record(z.unknown()),
  newPayload: z.record(z.unknown()),
  changedBy: z.string().uuid(),
  changedAt: z.string().datetime()
});

export const annotationApprovalSchema = z
  .object({
    id: z.string().uuid(),
    annotationId: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    approvalStatus: annotationApprovalStatusSchema,
    reviewerId: z.string().uuid().nullable(),
    reviewerComment: z.string().nullable(),
    reviewedAt: z.string().datetime().nullable()
  })
  .superRefine((approval, context) => {
    if (approval.approvalStatus === "pending" && approval.reviewedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pending approvals cannot have a reviewedAt timestamp."
      });
    }

    if (approval.approvalStatus !== "pending" && (!approval.reviewerId || !approval.reviewedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Approved or rejected annotations require a reviewer and review timestamp."
      });
    }
  });

export type EvidenceRegionType = z.infer<typeof evidenceRegionTypeSchema>;
export type CoordinateSystem = z.infer<typeof coordinateSystemSchema>;
export type FindingEvidenceRelationshipType = z.infer<typeof findingEvidenceRelationshipTypeSchema>;
export type AnnotationType = z.infer<typeof annotationTypeSchema>;
export type AnnotationStatus = z.infer<typeof annotationStatusSchema>;
export type AnnotationApprovalStatus = z.infer<typeof annotationApprovalStatusSchema>;
export type EvidenceRegion = z.infer<typeof evidenceRegionSchema>;
export type FindingEvidenceRegion = z.infer<typeof findingEvidenceRegionSchema>;
export type DocumentAnnotation = z.infer<typeof documentAnnotationSchema>;
export type ConditionAnnotationContent = z.infer<typeof conditionAnnotationContentSchema>;
export type AnnotationRevision = z.infer<typeof annotationRevisionSchema>;
export type AnnotationApproval = z.infer<typeof annotationApprovalSchema>;
