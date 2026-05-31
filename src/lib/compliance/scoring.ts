import type { ComplianceStatus, RiskLevel, SourceReference } from "@/types/domain";

export type ComplianceDecisionInput = {
  requirementSource?: SourceReference | null;
  evidenceSource?: SourceReference | null;
  directMatch: boolean;
  contradictionFound: boolean;
  missingEvidence: boolean;
  partiallySupported: boolean;
  notApplicable: boolean;
  confidenceScore: number;
  criticality?: RiskLevel;
};

export type ComplianceDecision = {
  status: ComplianceStatus;
  weightageScore: number;
  confidenceScore: number;
  requiresHumanReview: boolean;
  reasoning: string;
};

function hasRequiredSource(source?: SourceReference | null) {
  return Boolean(source?.documentName && source.pageNumber > 0 && source.quote);
}

export function clampScore(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function confidenceBand(confidenceScore: number) {
  const score = clampScore(confidenceScore, 0, 100);
  if (score >= 90) return "direct";
  if (score >= 70) return "strong";
  if (score >= 50) return "partial";
  if (score >= 30) return "weak";
  return "insufficient";
}

export function decideCompliance(input: ComplianceDecisionInput): ComplianceDecision {
  const confidenceScore = clampScore(input.confidenceScore, 0, 100);

  if (!hasRequiredSource(input.requirementSource) || (!input.notApplicable && !hasRequiredSource(input.evidenceSource))) {
    return {
      status: "not_verified",
      weightageScore: 0,
      confidenceScore,
      requiresHumanReview: true,
      reasoning: "Required source references are incomplete, so the finding cannot be verified."
    };
  }

  if (input.notApplicable) {
    return {
      status: "not_applicable",
      weightageScore: 0,
      confidenceScore,
      requiresHumanReview: confidenceScore < 70,
      reasoning: "The requirement is outside the stated review scope."
    };
  }

  if (input.contradictionFound) {
    return {
      status: "not_complied",
      weightageScore: 0,
      confidenceScore,
      requiresHumanReview: true,
      reasoning: "Submitted evidence directly contradicts the requirement."
    };
  }

  if (input.directMatch && confidenceScore >= 70) {
    return {
      status: "complied",
      weightageScore: 10,
      confidenceScore,
      requiresHumanReview: confidenceScore < 90,
      reasoning: "Direct source-backed evidence satisfies the requirement."
    };
  }

  if (input.partiallySupported) {
    const score = confidenceScore >= 70 ? 7 : confidenceScore >= 50 ? 5 : 3;
    return {
      status: "partially_complied",
      weightageScore: input.criticality === "critical" ? Math.min(score, 6) : score,
      confidenceScore,
      requiresHumanReview: true,
      reasoning: "Evidence exists but important details remain incomplete or conditional."
    };
  }

  if (input.missingEvidence || confidenceScore < 70) {
    return {
      status: "ambiguous_not_proven",
      weightageScore: confidenceScore >= 50 ? 4 : 2,
      confidenceScore,
      requiresHumanReview: true,
      reasoning: "Evidence is missing, indirect, unclear, or insufficient for a safe comparison."
    };
  }

  return {
    status: "ambiguous_not_proven",
    weightageScore: 4,
    confidenceScore,
    requiresHumanReview: true,
    reasoning: "The available information does not support a definitive compliance conclusion."
  };
}
