import type { ConditionEvaluationStatus } from "./condition-schemas";

export type DeterministicComparisonDecision = {
  status: ConditionEvaluationStatus;
  reasoning: string;
  missingInformation: string | null;
  confidence: number;
  humanReviewRequired: boolean;
};

export type NumericRangeComparisonInput = {
  requiredMin: number;
  requiredMax: number;
  requiredUnit: string;
  requiredMeasurementCondition?: string | null;
  proposedValue: number | null;
  proposedUnit: string | null;
  proposedMeasurementCondition?: string | null;
};

const unitAliases: Record<string, string> = {
  '"': "inch",
  in: "inch",
  inch: "inch",
  inches: "inch",
  mm: "mm",
  millimeter: "mm",
  millimeters: "mm"
};

function normalizeUnit(unit: string) {
  const value = unit.trim().toLowerCase();
  return unitAliases[value] ?? value;
}

function normalizeCondition(condition: string | null | undefined) {
  return condition?.trim().toLowerCase().replace(/\s+/g, " ") ?? null;
}

export function compareNumericRange(input: NumericRangeComparisonInput): DeterministicComparisonDecision {
  if (input.proposedValue === null || input.proposedUnit === null) {
    return {
      status: "not_proven",
      reasoning: "No directly comparable numeric evidence was provided.",
      missingInformation: `Provide a value in ${input.requiredUnit} under the required measurement conditions.`,
      confidence: 100,
      humanReviewRequired: true
    };
  }

  if (normalizeUnit(input.requiredUnit) !== normalizeUnit(input.proposedUnit)) {
    return {
      status: "ambiguous",
      reasoning: "The proposed and required units are not directly compatible without an explicit conversion basis.",
      missingInformation: `Provide the value in ${input.requiredUnit} or an approved conversion basis.`,
      confidence: 100,
      humanReviewRequired: true
    };
  }

  const requiredCondition = normalizeCondition(input.requiredMeasurementCondition);
  const proposedCondition = normalizeCondition(input.proposedMeasurementCondition);
  if (requiredCondition !== null && requiredCondition !== proposedCondition) {
    return {
      status: "ambiguous",
      reasoning: "The numeric values were measured under different or unspecified conditions and cannot be treated as equivalent.",
      missingInformation: `Provide evidence measured under: ${input.requiredMeasurementCondition}.`,
      confidence: 100,
      humanReviewRequired: true
    };
  }

  const passed = input.proposedValue >= input.requiredMin && input.proposedValue <= input.requiredMax;
  return passed
    ? {
        status: "complied",
        reasoning: `The proposed value ${input.proposedValue} ${input.proposedUnit} is within the required range.`,
        missingInformation: null,
        confidence: 100,
        humanReviewRequired: false
      }
    : {
        status: "not_complied",
        reasoning: `The proposed value ${input.proposedValue} ${input.proposedUnit} is outside the required range.`,
        missingInformation: null,
        confidence: 100,
        humanReviewRequired: true
      };
}

export function compareRequiredEvidencePresence(input: {
  evidenceKind: "certificate" | "standard" | "feature";
  expected: string;
  exactEvidence: string | null;
}): DeterministicComparisonDecision {
  if (input.exactEvidence === null || input.exactEvidence.trim().length === 0) {
    return {
      status: "not_proven",
      reasoning: `No source-backed ${input.evidenceKind} evidence was found for ${input.expected}.`,
      missingInformation: `Provide verifiable ${input.evidenceKind} evidence for ${input.expected}.`,
      confidence: 100,
      humanReviewRequired: true
    };
  }

  return {
    status: "complied",
    reasoning: `Direct ${input.evidenceKind} evidence was provided for ${input.expected}.`,
    missingInformation: null,
    confidence: 100,
    humanReviewRequired: false
  };
}
