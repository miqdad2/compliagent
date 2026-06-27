import type { ConditionEvaluationStatus, ParentFindingDerivationResult } from "./condition-schemas";

export type ParentConditionEvaluation = {
  id: string;
  status: ConditionEvaluationStatus;
  humanStatus?: ConditionEvaluationStatus | null;
  isMandatory: boolean;
  isHumanReviewRequired?: boolean;
};

const provenStatuses = new Set<ConditionEvaluationStatus>(["complied", "exceeds_requirement", "partially_complied"]);
const unresolvedStatuses = new Set<ConditionEvaluationStatus>(["partially_complied", "ambiguous", "not_proven"]);

export function deriveParentFindingStatus(evaluations: ParentConditionEvaluation[]): ParentFindingDerivationResult {
  const mandatoryEvaluations = evaluations.filter((evaluation) => evaluation.isMandatory);
  const effectiveEvaluations = mandatoryEvaluations.length > 0 ? mandatoryEvaluations : evaluations;
  const effectiveStatus = (evaluation: ParentConditionEvaluation) => evaluation.humanStatus ?? evaluation.status;
  const withStatus = effectiveEvaluations.map((evaluation) => ({ evaluation, status: effectiveStatus(evaluation) }));
  const idsFor = (statuses: Set<ConditionEvaluationStatus>) =>
    withStatus.filter((item) => statuses.has(item.status)).map((item) => item.evaluation.id);

  const compliedConditionIds = idsFor(new Set(["complied"]));
  const exceedsConditionIds = idsFor(new Set(["exceeds_requirement"]));
  const provenConditionIds = idsFor(provenStatuses);
  const unresolvedConditionIds = idsFor(unresolvedStatuses);
  const contradictoryConditionIds = idsFor(new Set(["not_complied"]));
  const notApplicableConditionIds = idsFor(new Set(["not_applicable"]));
  const verificationFailureConditionIds = idsFor(new Set(["not_verified"]));

  const base = {
    mandatoryConditionCount: mandatoryEvaluations.length,
    effectiveConditionCount: effectiveEvaluations.length,
    compliedConditionIds,
    exceedsConditionIds,
    provenConditionIds,
    unresolvedConditionIds,
    contradictoryConditionIds,
    notApplicableConditionIds,
    verificationFailureConditionIds
  };

  if (effectiveEvaluations.length === 0) {
    return {
      ...base,
      status: "not_verified",
      appliedRule: "no_evaluations",
      reasoning: "No condition evaluations exist, so the parent clause cannot be verified.",
      confidenceSummary: "Cannot assess — no evaluations present.",
      requiresHumanReview: true
    };
  }

  if (verificationFailureConditionIds.length > 0) {
    return {
      ...base,
      status: "not_verified",
      appliedRule: "verification_failure_precedence",
      reasoning: "At least one required condition has an untrusted source or extraction failure.",
      confidenceSummary: `${verificationFailureConditionIds.length} of ${effectiveEvaluations.length} conditions could not be verified.`,
      requiresHumanReview: true
    };
  }

  if (notApplicableConditionIds.length === effectiveEvaluations.length) {
    return {
      ...base,
      status: "not_applicable",
      appliedRule: "all_not_applicable",
      reasoning: "All evaluated conditions are genuinely outside the review scope.",
      confidenceSummary: "All conditions are not applicable.",
      requiresHumanReview: effectiveEvaluations.some((evaluation) => evaluation.isHumanReviewRequired)
    };
  }

  if (contradictoryConditionIds.length > 0) {
    return {
      ...base,
      status: "not_complied",
      appliedRule: "mandatory_contradiction",
      reasoning: "At least one mandatory condition is directly contradicted by submitted evidence.",
      confidenceSummary: `${contradictoryConditionIds.length} mandatory condition(s) directly contradicted.`,
      requiresHumanReview: true
    };
  }

  const applicableStatuses = withStatus.filter((item) => item.status !== "not_applicable").map((item) => item.status);
  const allProven = applicableStatuses.every((status) => status === "complied" || status === "exceeds_requirement");
  if (allProven) {
    const allExceeded = applicableStatuses.length > 0 && applicableStatuses.every((status) => status === "exceeds_requirement");
    return {
      ...base,
      status: allExceeded ? "exceeds_requirement" : "complied",
      appliedRule: allExceeded ? "all_exceed_requirement" : "all_mandatory_complied",
      reasoning: allExceeded
        ? "Every mandatory applicable condition is directly proven and exceeds its requirement without conflict."
        : "Every mandatory applicable condition is directly proven without conflict.",
      confidenceSummary: allExceeded
        ? `All ${applicableStatuses.length} applicable conditions exceed requirements.`
        : `All ${applicableStatuses.length} applicable conditions complied (${exceedsConditionIds.length} exceed).`,
      requiresHumanReview: effectiveEvaluations.some((evaluation) => evaluation.isHumanReviewRequired)
    };
  }

  if (provenConditionIds.length > 0 && unresolvedConditionIds.length > 0) {
    return {
      ...base,
      status: "partially_complied",
      appliedRule: "mixed_proven_and_unresolved",
      reasoning: "At least one mandatory condition is proven while another remains missing, ambiguous, or incomplete.",
      confidenceSummary: `${provenConditionIds.length} proven, ${unresolvedConditionIds.length} unresolved of ${effectiveEvaluations.length} conditions.`,
      requiresHumanReview: true
    };
  }

  return {
    ...base,
    status: "not_proven",
    appliedRule: "no_proven_no_contradiction",
    reasoning: "No mandatory condition is directly proven and no direct contradiction was established.",
    confidenceSummary: `0 of ${effectiveEvaluations.length} conditions proven; ${unresolvedConditionIds.length} unresolved.`,
    requiresHumanReview: true
  };
}
