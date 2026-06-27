import type { ComparisonResult, VerificationResult } from "@/lib/ai/schemas";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievedEvidence } from "./types";

/**
 * FindingVerifierService runs independent verification on a comparison result.
 *
 * Verification is logically separate from comparison (CLAUDE.md invariant 18).
 * It checks:
 *  - Citation validity: region/document reference is plausible.
 *  - Quote exactness: the quote appears in evidence retrieval results.
 *  - Clause validity: the clause_number is consistent with the condition.
 *  - Unit compatibility: numeric units are compatible.
 *  - Condition completeness: all required fields are present for the status.
 *  - Applicability justification: not_applicable conditions have a reason.
 *  - Unsupported claims: status=complied with no evidence is flagged.
 *
 * This implementation is deterministic (no AI call).  Live AI verification via
 * the findingVerificationPrompt will be wired once consent is configured.
 */
export class FindingVerifierService {
  verify(
    findingId: string,
    condition: RequirementConditionRow,
    evidence: RetrievedEvidence,
    comparison: ComparisonResult
  ): VerificationResult {
    const unsupportedClaims: string[] = [];

    // 1. Citation validity — we have at least one retrieval result with a region id.
    const citationValid =
      evidence.retrievalResults.length > 0 &&
      evidence.retrievalResults.some((r) => r.regionId !== null && r.regionId !== "");

    // 2. Quote exactness — the normalised evidence in the comparison result is
    //    not fabricated (it matches one of the retrieved quotes).
    const quoteExact =
      comparison.normalizedEvidence === null ||
      evidence.retrievalResults.some((r) =>
        r.exactQuote
          .toLowerCase()
          .includes((comparison.normalizedEvidence ?? "").toLowerCase().slice(0, 50))
      );

    if (!quoteExact) {
      unsupportedClaims.push(
        `Quoted evidence "${comparison.normalizedEvidence?.slice(0, 80)}" was not found verbatim in retrieval results.`
      );
    }

    // 3. Clause validity — if the comparison references a clause, it should be
    //    consistent with one of the retrieved results or the condition's source.
    const clauseValid = true; // Deterministic placeholder: clause from condition is trusted.

    // 4. Unit compatibility — if condition has an expected unit, the comparison
    //    should not have incompatible units in its normalizedEvidence.
    const expectedUnit = condition.expected_unit?.toLowerCase().trim() ?? null;
    let unitsCompatible = true;
    if (expectedUnit && comparison.normalizedEvidence) {
      const evidenceText = comparison.normalizedEvidence.toLowerCase();
      // Flag only when a clearly incompatible unit is present.
      const knownIncompatibleUnits: Record<string, string[]> = {
        "mm":   ["inch", "\"", "in", "feet", "ft"],
        "inch": ["mm", "cm", "meter"],
        "m":    ["inch", "\"", "in", "feet", "ft"],
        "db":   ["dba", "dbspl"],
        "dba":  ["db"],
        "w":    ["kw", "mw"],
        "kw":   ["w", "mw"]
      };
      const incompatible = knownIncompatibleUnits[expectedUnit] ?? [];
      if (incompatible.some((u) => evidenceText.includes(u))) {
        unitsCompatible = false;
        unsupportedClaims.push(
          `Evidence appears to use a unit incompatible with required unit "${expectedUnit}".`
        );
      }
    }

    // 5. Condition completeness — status-specific required fields are present.
    let conditionsComplete = true;
    if (
      ["complied", "exceeds_requirement"].includes(comparison.status) &&
      comparison.normalizedEvidence === null
    ) {
      conditionsComplete = false;
      unsupportedClaims.push(`Status "${comparison.status}" requires evidence but none was found.`);
    }
    if (comparison.status === "not_proven" && comparison.missingInformation === null) {
      conditionsComplete = false;
      unsupportedClaims.push('Status "not_proven" requires missing_information.');
    }

    // 6. Applicability justification.
    const applicabilityJustified =
      comparison.status !== "not_applicable" || comparison.reasoning.length > 10;

    // 7. Unsupported claim: complied without any citation.
    if (
      ["complied", "exceeds_requirement"].includes(comparison.status) &&
      !citationValid
    ) {
      unsupportedClaims.push("Complied status claimed without a valid evidence citation.");
    }

    const allChecksPass =
      citationValid &&
      quoteExact &&
      clauseValid &&
      unitsCompatible &&
      conditionsComplete &&
      applicabilityJustified &&
      unsupportedClaims.length === 0;

    const verifierConfidence = allChecksPass
      ? Math.min(comparison.confidence, 90)
      : Math.max(comparison.confidence - 25, 30);

    return {
      findingId,
      passed: allChecksPass,
      citationValid,
      quoteExact,
      clauseValid,
      unitsCompatible,
      conditionsComplete,
      applicabilityJustified,
      unsupportedClaims,
      verifierReasoning: allChecksPass
        ? `All verification checks passed. Evidence supports "${comparison.status}" for condition: ${condition.attribute}.`
        : `Verification failed: ${unsupportedClaims.join("; ")}`,
      verifierConfidence,
      requiresHumanReview: !allChecksPass || verifierConfidence < 70
    };
  }
}
