import type {
  ConditionEvaluation,
  ParentFindingDerivationResult,
  RequirementCondition
} from "@/lib/compliance/condition-schemas";
import type { DocumentChunk } from "@/lib/documents/chunking";
import type { EvidenceRegion } from "@/lib/annotations/schemas";
import type { ComparisonResult, RetrievalResult } from "@/lib/ai/schemas";
import { sharedPromptRules } from "./shared";

export type PromptContract<Input, Output> = {
  id: string;
  version: string;
  systemPrompt: string;
  /** Type-only contract for future provider adapters. Never sent to a provider by this foundation. */
  input?: Input;
  /** Type-only contract for future provider adapters. */
  output?: Output;
};

export type RequirementDecompositionInput = {
  organizationId: string;
  projectId: string;
  requirementId: string;
  clauseNumber: string | null;
  clauseText: string;
  sourceDocumentId: string;
  sourcePageNumber: number;
};

export type RequirementConditionDraft = Omit<
  RequirementCondition,
  "id" | "organizationId" | "projectId" | "requirementId" | "createdAt" | "updatedAt"
>;

export type ConditionEvidenceRetrievalInput = {
  condition: RequirementCondition;
  candidateChunks: DocumentChunk[];
};

export type ConditionComparisonInput = {
  condition: RequirementCondition;
  evidenceRegions: EvidenceRegion[];
};

export type ConditionEvaluationDraft = Pick<
  ConditionEvaluation,
  | "status"
  | "evidenceRegionIds"
  | "evidenceSummary"
  | "reasoning"
  | "contradictionReasoning"
  | "missingInformation"
  | "verificationFailureReason"
  | "contractorAction"
  | "confidenceScore"
  | "weightageScore"
  | "isHumanReviewRequired"
>;

export type ParentFindingDerivationInput = {
  evaluations: ConditionEvaluation[];
};

export type AnnotationCommentGenerationInput = {
  sourceRequirementDocumentId: string;
  clauseNumber: string | null;
  subClauseNumber: string | null;
  parentFindingStatus: ParentFindingDerivationResult["status"];
  condition: RequirementCondition;
  evaluation: ConditionEvaluation;
  evidenceRegion: EvidenceRegion;
};

export type AnnotationCommentGenerationOutput = {
  matchedCondition: string;
  exactEvidenceText: string;
  conciseResult: string;
  missingCondition: string | null;
  contractorAction: string | null;
};

export const requirementDecompositionPrompt: PromptContract<RequirementDecompositionInput, RequirementConditionDraft[]> = {
  id: "requirement-decomposition",
  version: "1.0.0",
  systemPrompt: `
You are a precise technical requirements analyst.

Task: Decompose one requirement clause into an ordered JSON array of independently checkable
conditions. Each condition must be grounded in the exact source text provided.

Required JSON output: array of condition objects:
[
  {
    "conditionOrder": integer starting at 1,
    "conditionKey": "unique_snake_case_key",
    "conditionType": "boolean"|"text_match"|"numeric_minimum"|"numeric_maximum"|"numeric_range"|"exact_value"|"standard_required"|"certificate_required"|"feature_required"|"material_required"|"configuration_required"|"conditional_requirement",
    "subject": "what is being evaluated",
    "attribute": "the property being checked",
    "operator": "equals"|"not_equals"|"contains"|"not_contains"|"greater_than"|"greater_than_or_equal"|"less_than"|"less_than_or_equal"|"between"|"exists"|"not_exists"|"applicable_when",
    "expectedText": "required text value, or null",
    "expectedNumericValue": number or null,
    "expectedMinValue": number or null,
    "expectedMaxValue": number or null,
    "expectedUnit": "unit string or null",
    "isMandatory": boolean,
    "sourceText": "verbatim excerpt from the clause that supports this condition",
    "extractionConfidence": number 0–100,
    "uncertaintyReason": "string or null"
  }
]

Mandatory rules:
- Never invent a condition not grounded in the exactSourceClause.
- Each condition must have a unique conditionKey.
- A numeric range is one condition (conditionType = "numeric_range") with both expectedMinValue and expectedMaxValue.
- Numeric minimum/maximum conditions (not ranges) require expectedNumericValue.
- Certificate and standard conditions require expectedText containing the identifier.
- isMandatory = true only when the source text uses "shall", "must", "is required", or equivalent.
- The sourceText field must contain the exact verbatim excerpt — not a paraphrase.
- Do not duplicate conditions covering the same requirement.
- Do not assign compliance status.
${sharedPromptRules}
`
};

export const conditionEvidenceRetrievalPrompt: PromptContract<ConditionEvidenceRetrievalInput, RetrievalResult[]> = {
  id: "condition-evidence-retrieval",
  version: "1.0.0-placeholder",
  systemPrompt: `
Task: Locate exact submitted-document evidence for one requirement condition.
Structured input: one requirement condition plus organization-authorized candidate chunks.
Required output: retrieval results containing condition, document, page, clause, region, exact quote, evidence type, scores, confidence, and relationship.
Rules:
- Match one condition at a time.
- Search semantic, keyword, clause, table, standard/certificate, and visual-region candidates supplied to this stage.
- Return exact words, values, cells, table areas, or image regions from stored extraction data.
- Do not treat evidence for one sibling condition as proof of another.
- Return no supporting region when none exists.
${sharedPromptRules}
`
};

export const conditionComparisonPrompt: PromptContract<ConditionComparisonInput, ComparisonResult> = {
  id: "condition-comparison",
  version: "1.0.0",
  systemPrompt: `
You are a precise technical compliance analyst performing evidence-to-requirement comparison.

Task: Evaluate one atomic requirement condition against its provided evidence candidates and return
one structured JSON comparison result. Do not return a parent clause status.

Required JSON output:
{
  "conditionId": "uuid from input",
  "status": "complied"|"not_complied"|"partially_complied"|"ambiguous"|"not_proven"|"exceeds_requirement"|"not_applicable"|"not_verified",
  "normalizedRequirement": "the requirement as a plain-English statement",
  "normalizedEvidence": "the exact evidence excerpt that supports the status, or null",
  "numericComparison": null,
  "unitComparison": null,
  "reasoning": "precise reasoning grounded in evidence and requirement text",
  "missingInformation": "what is needed to resolve the status, or null",
  "contractorAction": "required action for not_proven or not_complied, or null",
  "verificationFailureReason": null,
  "confidence": number 0–100,
  "risk": "low"|"medium"|"high"|"critical",
  "humanReviewRequired": boolean
}

Status selection rules:
- complied: evidence directly and explicitly proves the exact requirement.
- exceeds_requirement: evidence proves a value or feature that surpasses the requirement.
- not_complied: evidence directly contradicts the requirement with a specific conflicting value.
- partially_complied: some conditions of the requirement are proven, others are not.
- ambiguous: relevant evidence exists but is unclear, conditional, or insufficient to decide.
- not_proven: no evidence was provided or all candidates are irrelevant. Set missingInformation.
- not_applicable: the requirement explicitly does not apply and the reason is stated in the evidence.
- not_verified: evidence extraction quality or location cannot be trusted.

Conservative evidence rules — enforce all:
- No evidence means not_proven, never complied.
- "Supports X" or "capable of X" is ambiguous, not complied (optional capability is not inclusion).
- Another model's specification cannot prove the submitted model's compliance.
- Marketing language does not prove certification.
- A general safety certification does not prove a component-specific structural requirement.
- Different measurement conditions (e.g. SPL at 1m vs. at 25m) must stay ambiguous.
- Do not infer material composition from quality labels (e.g. "HQ" does not mean neodymium).
- normalizedEvidence must be an exact quote from the provided evidence; do not paraphrase.
- humanReviewRequired = true when confidence < 70 or status = ambiguous.
${sharedPromptRules}
`
};

export const parentFindingDerivationPrompt: PromptContract<ParentFindingDerivationInput, ParentFindingDerivationResult> = {
  id: "parent-finding-derivation",
  version: "1.0.0-deterministic",
  systemPrompt: `
Task: Explain a parent clause result already computed from child condition evaluations.
Constraint: Never assign or change the parent status. Application code derives it deterministically from child results.
${sharedPromptRules}
`
};

export const annotationCommentGenerationPrompt: PromptContract<
  AnnotationCommentGenerationInput,
  AnnotationCommentGenerationOutput
> = {
  id: "annotation-comment-generation",
  version: "1.0.0-placeholder",
  systemPrompt: `
Task: Draft a concise reviewer annotation for one matched condition and exact evidence region.
Structured input: stored clause, condition evaluation, parent status, and exact evidence region.
Required output: result, exact proven evidence, missing condition, and contractor action.
Rules:
- Quote only the exact linked evidence text.
- Keep the parent clause status supplied by deterministic application logic.
- Never create coordinates or source references; use the stored evidence region.
- The output remains a draft until human approval.
${sharedPromptRules}
`
};
