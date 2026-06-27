import { z } from "zod";

export const requirementConditionTypes = [
  "boolean",
  "text_match",
  "numeric_minimum",
  "numeric_maximum",
  "numeric_range",
  "exact_value",
  "standard_required",
  "certificate_required",
  "feature_required",
  "material_required",
  "configuration_required",
  "conditional_requirement"
] as const;

export const conditionOperators = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "between",
  "exists",
  "not_exists",
  "applicable_when"
] as const;

export const conditionEvaluationStatuses = [
  "complied",
  "partially_complied",
  "not_complied",
  "ambiguous",
  "not_proven",
  "exceeds_requirement",
  "not_applicable",
  "not_verified"
] as const;

export const conditionEvidenceRelationships = [
  "supports",
  "contradicts",
  "partially_supports",
  "contextual",
  "missing_expected_region"
] as const;

export const requirementConditionTypeSchema = z.enum(requirementConditionTypes);
export const conditionOperatorSchema = z.enum(conditionOperators);
export const conditionEvaluationStatusSchema = z.enum(conditionEvaluationStatuses);
export const conditionEvidenceRelationshipTypeSchema = z.enum(conditionEvidenceRelationships);

const nullableText = z.string().trim().min(1).nullable();
const numericConditionTypes = new Set<RequirementConditionType>([
  "numeric_minimum",
  "numeric_maximum",
  "numeric_range"
]);
const expectedTextConditionTypes = new Set<RequirementConditionType>([
  "text_match",
  "standard_required",
  "certificate_required",
  "feature_required",
  "material_required",
  "configuration_required",
  "conditional_requirement"
]);

export const requirementConditionSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    requirementId: z.string().uuid(),
    conditionOrder: z.number().int().positive(),
    conditionKey: z.string().trim().min(1),
    conditionType: requirementConditionTypeSchema,
    subject: z.string().trim().min(1),
    attribute: z.string().trim().min(1),
    operator: conditionOperatorSchema,
    expectedText: nullableText,
    expectedNumericValue: z.number().finite().nullable(),
    expectedMinValue: z.number().finite().nullable(),
    expectedMaxValue: z.number().finite().nullable(),
    expectedUnit: nullableText,
    isMandatory: z.boolean(),
    sourceText: z.string().trim().min(1),
    extractionConfidence: z.number().min(0).max(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .superRefine((condition, context) => {
    if (
      condition.expectedMinValue !== null &&
      condition.expectedMaxValue !== null &&
      condition.expectedMinValue > condition.expectedMaxValue
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedMinValue"],
        message: "Numeric range minimum must be less than or equal to the maximum."
      });
    }

    if (numericConditionTypes.has(condition.conditionType) && condition.expectedUnit === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedUnit"],
        message: "Numeric conditions require an expected unit."
      });
    }

    if (condition.conditionType === "numeric_minimum" && condition.expectedMinValue === null) {
      addExpectedValueIssue(context, "expectedMinValue", "Numeric minimum conditions require a minimum value.");
    }

    if (condition.conditionType === "numeric_maximum" && condition.expectedMaxValue === null) {
      addExpectedValueIssue(context, "expectedMaxValue", "Numeric maximum conditions require a maximum value.");
    }

    if (
      condition.conditionType === "numeric_range" &&
      (condition.expectedMinValue === null || condition.expectedMaxValue === null)
    ) {
      addExpectedValueIssue(context, "expectedMinValue", "Numeric range conditions require minimum and maximum values.");
    }

    if (expectedTextConditionTypes.has(condition.conditionType) && condition.expectedText === null) {
      addExpectedValueIssue(context, "expectedText", `${condition.conditionType} conditions require expected text.`);
    }

    if (
      condition.conditionType === "exact_value" &&
      condition.expectedText === null &&
      condition.expectedNumericValue === null
    ) {
      addExpectedValueIssue(context, "expectedText", "Exact-value conditions require expected text or a numeric value.");
    }

    if (
      condition.conditionType === "exact_value" &&
      condition.expectedNumericValue !== null &&
      condition.expectedUnit === null
    ) {
      addExpectedValueIssue(context, "expectedUnit", "Numeric exact-value conditions require an expected unit.");
    }
  });

export const conditionEvaluationSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    reviewId: z.string().uuid(),
    findingId: z.string().uuid(),
    requirementId: z.string().uuid(),
    requirementConditionId: z.string().uuid(),
    status: conditionEvaluationStatusSchema,
    evidenceRegionIds: z.array(z.string().uuid()),
    evidenceSummary: nullableText,
    reasoning: z.string().trim().min(1),
    contradictionReasoning: nullableText,
    missingInformation: nullableText,
    verificationFailureReason: nullableText,
    contractorAction: nullableText,
    confidenceScore: z.number().min(0).max(100),
    weightageScore: z.number().min(0).max(10),
    isHumanReviewRequired: z.boolean(),
    humanStatus: conditionEvaluationStatusSchema.nullable(),
    humanComment: nullableText,
    reviewedBy: z.string().uuid().nullable(),
    reviewedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .superRefine((evaluation, context) => {
    const hasEvidence = evaluation.evidenceRegionIds.length > 0 && evaluation.evidenceSummary !== null;

    if (["complied", "exceeds_requirement"].includes(evaluation.status) && !hasEvidence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRegionIds"],
        message: "Complied and exceeds-requirement evaluations require linked evidence and an evidence summary."
      });
    }

    if (evaluation.status === "partially_complied" && (!hasEvidence || evaluation.missingInformation === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Partially complied requires at least one proven element and one unresolved element."
      });
    }

    if (evaluation.status === "ambiguous" && !hasEvidence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRegionIds"],
        message: "Ambiguous evaluations require the unclear evidence that was found."
      });
    }

    if (evaluation.status === "not_proven" && evaluation.missingInformation === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["missingInformation"],
        message: "Not-proven evaluations require missing information."
      });
    }

    if (evaluation.status === "not_complied" && evaluation.contradictionReasoning === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contradictionReasoning"],
        message: "Not-complied evaluations require contradiction reasoning."
      });
    }

    if (evaluation.status === "not_verified" && evaluation.verificationFailureReason === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationFailureReason"],
        message: "Not-verified evaluations require a verification failure reason."
      });
    }

    const hasHumanDecision = evaluation.humanStatus !== null;
    const hasReviewerAudit = evaluation.reviewedBy !== null && evaluation.reviewedAt !== null;
    if (hasHumanDecision !== hasReviewerAudit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["humanStatus"],
        message: "A human status requires reviewer identity and review time, and vice versa."
      });
    }
  });

export const conditionEvidenceRegionSchema = z
  .object({
    id: z.string().uuid(),
    conditionEvaluationId: z.string().uuid(),
    evidenceRegionId: z.string().uuid().nullable(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    relationshipType: conditionEvidenceRelationshipTypeSchema,
    createdAt: z.string().datetime()
  })
  .superRefine((link, context) => {
    const missingExpectedRegion = link.relationshipType === "missing_expected_region";
    if (missingExpectedRegion !== (link.evidenceRegionId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRegionId"],
        message: "Only missing-expected-region links may omit an evidence region."
      });
    }
  });

export const parentFindingDerivationResultSchema = z.object({
  status: conditionEvaluationStatusSchema,
  appliedRule: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
  confidenceSummary: z.string().trim().min(1),
  mandatoryConditionCount: z.number().int().nonnegative(),
  effectiveConditionCount: z.number().int().nonnegative(),
  compliedConditionIds: z.array(z.string().uuid()),
  exceedsConditionIds: z.array(z.string().uuid()),
  provenConditionIds: z.array(z.string().uuid()),
  unresolvedConditionIds: z.array(z.string().uuid()),
  contradictoryConditionIds: z.array(z.string().uuid()),
  notApplicableConditionIds: z.array(z.string().uuid()),
  verificationFailureConditionIds: z.array(z.string().uuid()),
  requiresHumanReview: z.boolean()
});

function addExpectedValueIssue(context: z.RefinementCtx, path: string, message: string) {
  context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
}

export type RequirementConditionType = z.infer<typeof requirementConditionTypeSchema>;
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;
export type ConditionEvaluationStatus = z.infer<typeof conditionEvaluationStatusSchema>;
export type ConditionEvidenceRelationship = z.infer<typeof conditionEvidenceRelationshipTypeSchema>;
export type RequirementCondition = z.infer<typeof requirementConditionSchema>;
export type ConditionEvaluation = z.infer<typeof conditionEvaluationSchema>;
export type ConditionEvidenceRegion = z.infer<typeof conditionEvidenceRegionSchema>;
export type ParentFindingDerivationResult = z.infer<typeof parentFindingDerivationResultSchema>;
