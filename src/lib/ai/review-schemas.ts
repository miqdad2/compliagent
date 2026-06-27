/**
 * Zod schemas for AI outputs specific to the controlled review pipeline.
 * Kept separate from the general schemas.ts to avoid circular imports.
 */
import { z } from "zod";
import { conditionEvaluationStatusSchema } from "@/lib/compliance/condition-schemas";

const nonEmpty = z.string().trim().min(1);
const confidence = z.number().min(0).max(100);

// ── Requirement refinement ────────────────────────────────────────────────────

export const mandatoryLevelSchema = z.enum(["mandatory", "conditional", "informative", "unknown"]);

export const requirementRefinementOutputSchema = z
  .object({
    isReviewable:            z.boolean(),
    normalizedRequirement:   nonEmpty,
    mandatoryLevel:          mandatoryLevelSchema,
    requirementCategory:     nonEmpty,
    conditionalApplicability: nonEmpty.nullable(),
    detectedEntities:        z.array(nonEmpty),
    confidence:              confidence,
    humanReviewRequired:     z.boolean(),
    uncertaintyReasons:      z.array(nonEmpty)
  })
  .superRefine((r, ctx) => {
    if (!r.isReviewable && r.confidence > 80) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confidence"],
        message: "Non-reviewable requirements should have confidence ≤ 80."
      });
    }
  });

export type RequirementRefinementOutput = z.infer<typeof requirementRefinementOutputSchema>;

// ── Condition decomposition ───────────────────────────────────────────────────

export const conditionDecompositionItemSchema = z.object({
  conditionOrder:       z.number().int().positive(),
  conditionKey:         nonEmpty,
  conditionType:        z.enum([
    "boolean", "text_match", "numeric_minimum", "numeric_maximum",
    "numeric_range", "exact_value", "standard_required", "certificate_required",
    "feature_required", "material_required", "configuration_required", "conditional_requirement"
  ]),
  subject:              nonEmpty,
  attribute:            nonEmpty,
  operator:             z.enum([
    "equals", "not_equals", "contains", "not_contains",
    "greater_than", "greater_than_or_equal", "less_than",
    "less_than_or_equal", "between", "exists", "not_exists", "applicable_when"
  ]),
  expectedText:         nonEmpty.nullable(),
  expectedNumericValue: z.number().finite().nullable(),
  expectedMinValue:     z.number().finite().nullable(),
  expectedMaxValue:     z.number().finite().nullable(),
  expectedUnit:         nonEmpty.nullable(),
  isMandatory:          z.boolean(),
  sourceText:           nonEmpty,
  extractionConfidence: confidence,
  uncertaintyReason:    nonEmpty.nullable()
});

export const conditionDecompositionOutputSchema = z
  .array(conditionDecompositionItemSchema)
  .min(1, "At least one condition is required.")
  .superRefine((conditions, ctx) => {
    const keys = conditions.map((c) => c.conditionKey);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate condition keys are not allowed." });
    }
    for (const [i, c] of conditions.entries()) {
      if (c.conditionType === "numeric_range" && (c.expectedMinValue === null || c.expectedMaxValue === null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "expectedMinValue"],
          message: "Numeric range conditions require both min and max values."
        });
      }
      if (
        ["numeric_minimum", "numeric_maximum", "exact_value"].includes(c.conditionType) &&
        c.expectedNumericValue === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "expectedNumericValue"],
          message: `${c.conditionType} conditions require a numeric value.`
        });
      }
    }
  });

export type ConditionDecompositionItem = z.infer<typeof conditionDecompositionItemSchema>;
export type ConditionDecompositionOutput = z.infer<typeof conditionDecompositionOutputSchema>;

// ── Evidence reranking ────────────────────────────────────────────────────────

export const evidenceSufficiencySchema = z.enum([
  "DIRECT", "PARTIAL", "CONTRADICTORY", "CONTEXTUAL", "IRRELEVANT", "UNVERIFIED"
]);
export type EvidenceSufficiencyClass = z.infer<typeof evidenceSufficiencySchema>;

export const evidenceRerankingItemSchema = z.object({
  regionId:                      nonEmpty,
  classification:                evidenceSufficiencySchema,
  semanticScore:                 z.number().min(0).max(1),
  reasoning:                     nonEmpty,
  sameProductModel:              z.boolean(),
  featureIncluded:               z.boolean().nullable(),
  measurementConditionsCompatible: z.boolean().nullable(),
  evidenceSufficient:            z.boolean()
});

export const evidenceRerankingOutputSchema = z.array(evidenceRerankingItemSchema);
export type EvidenceRerankingItem = z.infer<typeof evidenceRerankingItemSchema>;
export type EvidenceRerankingOutput = z.infer<typeof evidenceRerankingOutputSchema>;

// ── AI condition comparison ───────────────────────────────────────────────────
// Extends the existing comparisonResultSchema; re-exported here for convenience.
// Kept as a separate output type to allow the AI to return candidate IDs for citation.

export const aiComparisonOutputSchema = z
  .object({
    conditionId:         z.string().uuid(),
    proposedStatus:      conditionEvaluationStatusSchema,
    citedCandidateIds:   z.array(nonEmpty),
    reasoning:           nonEmpty,
    missingInformation:  nonEmpty.nullable(),
    contractorAction:    nonEmpty.nullable(),
    confidence:          confidence,
    uncertaintyReason:   nonEmpty.nullable(),
    humanReviewRequired: z.boolean()
  })
  .superRefine((r, ctx) => {
    if (["complied", "exceeds_requirement"].includes(r.proposedStatus) && r.citedCandidateIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citedCandidateIds"],
        message: "Complied/exceeds requires at least one cited candidate."
      });
    }
    if (r.proposedStatus === "not_proven" && r.missingInformation === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["missingInformation"],
        message: "not_proven requires missing information."
      });
    }
    if (r.confidence < 70 && !r.humanReviewRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["humanReviewRequired"],
        message: "Confidence < 70 requires human review."
      });
    }
  });

export type AiComparisonOutput = z.infer<typeof aiComparisonOutputSchema>;

// ── Confidence flags ──────────────────────────────────────────────────────────

export const confidenceFlags = [
  "LOW_EXTRACTION_CONFIDENCE",
  "LOW_REQUIREMENT_CONFIDENCE",
  "LOW_RETRIEVAL_CONFIDENCE",
  "LOW_COMPARISON_CONFIDENCE",
  "VERIFIER_DISAGREEMENT",
  "CITATION_FAILURE",
  "MODEL_IDENTITY_UNCERTAIN",
  "UNIT_COMPATIBILITY_UNCERTAIN",
  "MISSING_DIRECT_EVIDENCE",
  "AI_COMPARISON_USED",
  "AI_RERANKING_USED",
  "AI_REFINEMENT_USED",
  "AI_DECOMPOSITION_USED",
  "DETERMINISTIC_FALLBACK_USED",
  "REPAIR_ATTEMPTED",
  "PROVIDER_TIMEOUT",
  "CONSENT_BLOCKED"
] as const;

export type ConfidenceFlag = (typeof confidenceFlags)[number];
