import { z } from "zod";
import { conditionEvaluationStatusSchema, conditionEvidenceRelationshipTypeSchema } from "@/lib/compliance/condition-schemas";
import { riskLevels } from "@/types/domain";
import { aiProviderSchema } from "./provider";
import { aiTaskTypes } from "./tasks";

export const aiRunStatuses = ["queued", "running", "completed", "failed", "cancelled"] as const;
export const aiValidationStatuses = ["pending", "passed", "failed", "repaired"] as const;
export const aiVerificationStatuses = ["pending", "passed", "failed", "not_required"] as const;

export const aiTaskTypeSchema = z.enum(aiTaskTypes);
export const aiRunStatusSchema = z.enum(aiRunStatuses);
export const aiValidationStatusSchema = z.enum(aiValidationStatuses);
export const aiVerificationStatusSchema = z.enum(aiVerificationStatuses);

const nullableText = z.string().trim().min(1).nullable();
const confidence = z.number().min(0).max(100);

export const aiRunMetadataSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    reviewId: z.string().uuid().nullable(),
    documentId: z.string().uuid().nullable(),
    taskType: aiTaskTypeSchema,
    provider: aiProviderSchema,
    model: z.string().trim().min(1),
    promptVersion: z.string().trim().min(1),
    providerRunId: nullableText,
    inputHash: z.string().regex(/^[a-f0-9]{64}$/i, "Input hash must be a SHA-256 hex digest."),
    status: aiRunStatusSchema,
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    latencyMs: z.number().int().nonnegative().nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCost: z.number().nonnegative().nullable(),
    validationStatus: aiValidationStatusSchema,
    verificationStatus: aiVerificationStatusSchema,
    errorCode: nullableText,
    errorMessage: nullableText,
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime()
  })
  .superRefine((run, context) => {
    if (["running", "completed", "failed"].includes(run.status) && run.startedAt === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["startedAt"], message: "Started AI runs require a start time." });
    }
    if (["completed", "failed", "cancelled"].includes(run.status) && run.completedAt === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "Terminal AI runs require a completion time." });
    }
    if (run.status === "completed" && (run.latencyMs === null || run.validationStatus === "pending")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["latencyMs"], message: "Completed AI runs require latency and a terminal validation status." });
    }
    if (run.status === "failed" && (run.errorCode === null || run.errorMessage === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "Failed AI runs require an error code and message." });
    }
  });

export const retrievalResultSchema = z
  .object({
    conditionId: z.string().uuid(),
    documentId: z.string().uuid(),
    pageNumber: z.number().int().positive(),
    clauseNumber: nullableText,
    regionId: z.string().uuid(),
    exactQuote: z.string().trim().min(1),
    evidenceType: z.string().trim().min(1),
    semanticScore: z.number().min(0).max(1),
    keywordScore: z.number().min(0).max(1),
    retrievalConfidence: confidence,
    extractionConfidence: confidence,
    relationshipType: conditionEvidenceRelationshipTypeSchema
  })
  .refine((result) => result.relationshipType !== "missing_expected_region", {
    path: ["relationshipType"],
    message: "A concrete retrieval result cannot represent a missing expected region."
  });

export const numericComparisonSchema = z.object({
  operator: z.enum(["minimum", "maximum", "range", "exact"]),
  requiredValue: z.number().finite().nullable(),
  requiredMin: z.number().finite().nullable(),
  requiredMax: z.number().finite().nullable(),
  proposedValue: z.number().finite().nullable(),
  passed: z.boolean().nullable()
});

export const unitComparisonSchema = z.object({
  requiredUnit: nullableText,
  proposedUnit: nullableText,
  compatible: z.boolean(),
  conversionApplied: z.boolean()
});

export const comparisonResultSchema = z
  .object({
    conditionId: z.string().uuid(),
    status: conditionEvaluationStatusSchema,
    normalizedRequirement: z.string().trim().min(1),
    normalizedEvidence: nullableText,
    numericComparison: numericComparisonSchema.nullable(),
    unitComparison: unitComparisonSchema.nullable(),
    reasoning: z.string().trim().min(1),
    missingInformation: nullableText,
    contractorAction: nullableText,
    verificationFailureReason: nullableText,
    confidence: confidence,
    risk: z.enum(riskLevels),
    humanReviewRequired: z.boolean()
  })
  .superRefine((result, context) => {
    if (["complied", "exceeds_requirement"].includes(result.status) && result.normalizedEvidence === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["normalizedEvidence"], message: "A proven condition requires evidence." });
    }
    if (result.status === "not_proven" && result.missingInformation === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["missingInformation"], message: "Not-proven results require missing information." });
    }
    if (result.status === "not_verified" && result.verificationFailureReason === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["verificationFailureReason"], message: "Not-verified results require a verification failure reason." });
    }
    if (result.confidence < 70 && !result.humanReviewRequired) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["humanReviewRequired"], message: "Confidence below 70 requires human review." });
    }
  });

export const verificationResultSchema = z
  .object({
    findingId: z.string().uuid(),
    passed: z.boolean(),
    citationValid: z.boolean(),
    quoteExact: z.boolean(),
    clauseValid: z.boolean(),
    unitsCompatible: z.boolean(),
    conditionsComplete: z.boolean(),
    applicabilityJustified: z.boolean(),
    unsupportedClaims: z.array(z.string().trim().min(1)),
    verifierReasoning: z.string().trim().min(1),
    verifierConfidence: confidence,
    requiresHumanReview: z.boolean()
  })
  .superRefine((result, context) => {
    const checksPass =
      result.citationValid &&
      result.quoteExact &&
      result.clauseValid &&
      result.unitsCompatible &&
      result.conditionsComplete &&
      result.applicabilityJustified &&
      result.unsupportedClaims.length === 0;
    if (result.passed && !checksPass) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["passed"], message: "Verification cannot pass while any verification check fails." });
    }
    if (result.verifierConfidence < 70 && !result.requiresHumanReview) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["requiresHumanReview"], message: "Low-confidence verification requires human review." });
    }
  });

export type AiRunStatus = z.infer<typeof aiRunStatusSchema>;
export type AiValidationStatus = z.infer<typeof aiValidationStatusSchema>;
export type AiVerificationStatus = z.infer<typeof aiVerificationStatusSchema>;
export type AiRunMetadata = z.infer<typeof aiRunMetadataSchema>;
export type RetrievalResult = z.infer<typeof retrievalResultSchema>;
export type ComparisonResult = z.infer<typeof comparisonResultSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
