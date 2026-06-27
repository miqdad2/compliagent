import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievedEvidence } from "./types";
import type { ComparisonResult } from "@/lib/ai/schemas";
import {
  compareNumericRange,
  compareRequiredEvidencePresence
} from "@/lib/compliance/deterministic-comparison";
import type { ConditionEvaluationStatus } from "@/lib/compliance/condition-schemas";

/** Numeric value pattern — captures a decimal or integer. */
const NUMERIC_RE = /(\d+(?:\.\d+)?)\s*([a-zA-Z"'\-/]{1,10})?/;

/** Extract the first numeric value and optional unit from text. */
function extractNumericFromText(
  text: string
): { value: number; unit: string | null } | null {
  const m = NUMERIC_RE.exec(text);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2]?.trim() || null };
}

/** Safe fallback unit string when no unit is specified. */
const DIMENSIONLESS = "unit";

/**
 * ConditionComparisonService runs deterministic comparison for each condition
 * type and returns a conservative placeholder result for types that require
 * live AI reasoning.
 *
 * This service never invents compliance — only deterministic numeric and
 * evidence-presence checks can produce COMPLIED. All other condition types
 * return NOT_PROVEN or AMBIGUOUS pending live AI or human confirmation.
 */
export class ConditionComparisonService {
  compare(
    condition: RequirementConditionRow,
    evidence: RetrievedEvidence
  ): ComparisonResult {
    const primaryQuote = evidence.primaryQuote;
    const hasEvidence = evidence.retrievalResults.length > 0 && evidence.sufficiency !== "irrelevant";

    // ── Numeric range: min / max / range / exact ──────────────────────────────
    if (
      condition.condition_type === "numeric_minimum" ||
      condition.condition_type === "numeric_maximum" ||
      condition.condition_type === "numeric_range" ||
      condition.condition_type === "exact_value"
    ) {
      return this._compareNumeric(condition, primaryQuote, hasEvidence);
    }

    // ── Evidence-presence: boolean, feature, material, config ─────────────────
    if (
      condition.condition_type === "boolean" ||
      condition.condition_type === "feature_required" ||
      condition.condition_type === "material_required" ||
      condition.condition_type === "configuration_required"
    ) {
      const decision = compareRequiredEvidencePresence({
        evidenceKind: "feature",
        expected:     condition.expected_text ?? condition.attribute,
        exactEvidence: primaryQuote
      });
      const status = decision.status;
      return buildResult(condition, status, primaryQuote, decision.confidence, decision.reasoning, decision.missingInformation);
    }

    // ── Standard / certificate required ──────────────────────────────────────
    if (condition.condition_type === "standard_required") {
      const decision = compareRequiredEvidencePresence({
        evidenceKind: "standard",
        expected:     condition.expected_text ?? condition.attribute,
        exactEvidence: primaryQuote
      });
      return buildResult(condition, decision.status, primaryQuote, decision.confidence, decision.reasoning, decision.missingInformation);
    }

    if (condition.condition_type === "certificate_required") {
      const decision = compareRequiredEvidencePresence({
        evidenceKind: "certificate",
        expected:     condition.expected_text ?? condition.attribute,
        exactEvidence: primaryQuote
      });
      return buildResult(condition, decision.status, primaryQuote, decision.confidence, decision.reasoning, decision.missingInformation);
    }

    // ── Text match / conditional — placeholder (requires live AI) ─────────────
    if (!hasEvidence || primaryQuote === null) {
      return buildResult(
        condition,
        "not_proven",
        null,
        45,
        `No evidence found for condition: ${condition.attribute}.`,
        `Provide documentation confirming "${condition.expected_text ?? condition.attribute}".`
      );
    }

    const confidence = evidence.sufficiency === "direct" ? 68 : 50;
    return buildResult(
      condition,
      "ambiguous",
      primaryQuote,
      confidence,
      `Evidence found but requires human or AI confirmation: "${primaryQuote.slice(0, 200)}".`,
      null
    );
  }

  private _compareNumeric(
    condition: RequirementConditionRow,
    primaryQuote: string | null,
    hasEvidence: boolean
  ): ComparisonResult {
    const proposed = primaryQuote ? extractNumericFromText(primaryQuote) : null;
    const requiredUnit = condition.expected_unit ?? DIMENSIONLESS;

    // Map condition type to min/max bounds.
    let requiredMin: number;
    let requiredMax: number;

    if (condition.condition_type === "numeric_minimum") {
      requiredMin = condition.expected_numeric_value ?? 0;
      requiredMax = Infinity;
    } else if (condition.condition_type === "numeric_maximum") {
      requiredMin = -Infinity;
      requiredMax = condition.expected_numeric_value ?? 0;
    } else if (condition.condition_type === "numeric_range") {
      requiredMin = condition.expected_min_value ?? 0;
      requiredMax = condition.expected_max_value ?? Infinity;
    } else {
      // exact_value: range is [value, value].
      requiredMin = condition.expected_numeric_value ?? 0;
      requiredMax = condition.expected_numeric_value ?? 0;
    }

    // When no required unit is specified (DIMENSIONLESS placeholder), treat the
    // proposed unit as compatible — the comparison is purely numeric.
    const effectiveProposedUnit =
      requiredUnit === DIMENSIONLESS
        ? requiredUnit
        : proposed?.unit ?? (hasEvidence ? requiredUnit : null);

    const decision = compareNumericRange({
      requiredMin,
      requiredMax,
      requiredUnit,
      proposedValue: proposed?.value ?? null,
      proposedUnit:  effectiveProposedUnit
    });

    const confidence = !hasEvidence
      ? 45
      : decision.status === "complied"
        ? 85
        : 75;

    return buildResult(
      condition,
      decision.status,
      primaryQuote,
      confidence,
      decision.reasoning,
      decision.missingInformation
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildResult(
  condition: RequirementConditionRow,
  status: ConditionEvaluationStatus,
  primaryQuote: string | null,
  confidence: number,
  reasoning: string,
  missingInformation: string | null
): ComparisonResult {
  const needsHumanReview = confidence < 70 || status === "ambiguous";
  return {
    conditionId:          condition.id,
    status,
    normalizedRequirement: `${condition.subject}: ${condition.attribute} ${condition.operator} ${condition.expected_text ?? condition.expected_numeric_value ?? ""}`.trim(),
    normalizedEvidence:   primaryQuote?.slice(0, 400) ?? null,
    numericComparison:    null,
    unitComparison:       null,
    reasoning,
    missingInformation,
    contractorAction:
      status === "not_proven" || status === "not_complied"
        ? `Provide documentation confirming ${condition.attribute} meets ${condition.expected_text ?? String(condition.expected_numeric_value ?? "requirement")}.`
        : null,
    verificationFailureReason: null,
    confidence,
    risk:                 confidence < 60 ? "high" : confidence < 75 ? "medium" : "low",
    humanReviewRequired:  needsHumanReview
  };
}
