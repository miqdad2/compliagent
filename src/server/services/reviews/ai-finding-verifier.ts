/**
 * AI-assisted finding verifier.
 *
 * Runs as a logically separate pass from comparison, using a separate
 * AI run and the "verifier" model tier (configured independently).
 *
 * When AI is unavailable, falls back to the deterministic verifier and flags
 * the result for human review. The deterministic verifier result is always
 * preserved alongside the AI result.
 *
 * Disagreement between comparison and verifier is recorded but never
 * auto-resolved — both results are preserved for the human reviewer.
 */
import type { ComparisonResult, VerificationResult } from "@/lib/ai/schemas";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievedEvidence } from "./types";
import type { ConfidenceFlag } from "@/lib/ai/review-schemas";
import { verificationResultSchema } from "@/lib/ai/schemas";
import { FindingVerifierService } from "./finding-verifier";
import { AI_TASK } from "@/lib/ai/tasks";
import { findingVerificationPrompt } from "@/lib/prompts/finding-verification";
import { hashSafeInputRef, type ControlledAiExecutionService } from "@/server/services/ai/controlled-execution";
import type { AuthProfile } from "@/lib/permissions/server";

/** Conservative status precedence (lower index = more conservative). */
const STATUS_PRECEDENCE = [
  "not_verified", "not_complied", "not_proven", "ambiguous",
  "partially_complied", "complied", "exceeds_requirement", "not_applicable"
] as const;

function moreConservative(a: string, b: string): string {
  const ai = STATUS_PRECEDENCE.indexOf(a as typeof STATUS_PRECEDENCE[number]);
  const bi = STATUS_PRECEDENCE.indexOf(b as typeof STATUS_PRECEDENCE[number]);
  if (ai === -1 && bi === -1) return a;
  if (ai === -1) return b;
  if (bi === -1) return a;
  return ai <= bi ? a : b;
}

export type VerificationContext = {
  actor:          AuthProfile;
  organizationId: string;
  projectId:      string;
  reviewId:       string;
  findingId:      string;
};

export type VerificationOutcome = {
  deterministicResult:    VerificationResult;
  aiResult:               VerificationResult | null;
  finalResult:            VerificationResult;
  disagreementDetected:   boolean;
  conservativeStatus:     string | null;
  usedAi:                 boolean;
  aiRunId:                string | null;
  flags:                  ConfidenceFlag[];
};

export class AiFindingVerifierService {
  private readonly deterministicVerifier = new FindingVerifierService();

  constructor(private readonly executor: ControlledAiExecutionService | null) {}

  async verify(
    condition: RequirementConditionRow,
    evidence: RetrievedEvidence,
    comparison: ComparisonResult,
    context: VerificationContext
  ): Promise<VerificationOutcome> {
    // Always run deterministic verifier first.
    const deterministicResult = this.deterministicVerifier.verify(
      context.findingId, condition, evidence, comparison
    );

    // If no AI executor is available, return deterministic only.
    if (!this.executor) {
      return {
        deterministicResult,
        aiResult:            null,
        finalResult:         deterministicResult,
        disagreementDetected: false,
        conservativeStatus:  null,
        usedAi:              false,
        aiRunId:             null,
        flags:               ["DETERMINISTIC_FALLBACK_USED"]
      };
    }

    // Build minimal verification input — only excerpts, no full documents.
    const evidenceSummary = evidence.retrievalResults
      .slice(0, 5)
      .map((r) => `[${r.regionId}] "${r.exactQuote.slice(0, 300)}"`)
      .join("\n");

    const userMessage = [
      `Finding ID: ${context.findingId}`,
      `Condition: ${condition.subject} / ${condition.attribute} ${condition.operator} ${condition.expected_text ?? ""}`,
      `Proposed status: ${comparison.status}`,
      `Comparison reasoning: "${comparison.reasoning.slice(0, 400)}"`,
      `Normalized evidence: ${comparison.normalizedEvidence ? `"${comparison.normalizedEvidence.slice(0, 300)}"` : "(none)"}`,
      `Retrieval results:`,
      evidenceSummary || "(none)"
    ].join("\n");

    const inputHash = hashSafeInputRef({
      organizationId: context.organizationId,
      projectId:      context.projectId,
      reviewId:       context.reviewId,
      entityId:       context.findingId,
      taskType:       AI_TASK.FINDING_VERIFICATION,
      promptVersion:  findingVerificationPrompt.version
    });

    const result = await this.executor.execute({
      actor:                          context.actor,
      organizationId:                 context.organizationId,
      projectId:                      context.projectId,
      reviewId:                       context.reviewId,
      documentId:                     null,
      taskType:                       AI_TASK.FINDING_VERIFICATION,
      promptVersion:                  findingVerificationPrompt.version,
      systemPrompt:                   findingVerificationPrompt.systemPrompt,
      input:                          [{ type: "text", text: userMessage }],
      inputHash,
      outputSchema:                   verificationResultSchema,
      outputSchemaName:               "VerificationResult",
      temperature:                    0,
      timeoutMs:                      30_000,
      externalTransmissionRequested:  true,
      multimodalTransmissionRequested: false
    });

    const flags: ConfidenceFlag[] = [];

    if (!result.ok) {
      // AI verifier failed — fall back to deterministic, require human review.
      flags.push("DETERMINISTIC_FALLBACK_USED");
      const safeResult: VerificationResult = {
        ...deterministicResult,
        requiresHumanReview: true,
        verifierReasoning: `${deterministicResult.verifierReasoning} [AI verifier failed: ${result.error.message}]`
      };
      return {
        deterministicResult,
        aiResult:            null,
        finalResult:         safeResult,
        disagreementDetected: false,
        conservativeStatus:  null,
        usedAi:              false,
        aiRunId:             null,
        flags
      };
    }

    const aiResult = result.data;
    flags.push("AI_COMPARISON_USED"); // Reuse flag — no specific "verifier used" flag yet.
    if (result.repaired) flags.push("REPAIR_ATTEMPTED");
    if (aiResult.verifierConfidence < 70) flags.push("LOW_COMPARISON_CONFIDENCE");

    // Detect disagreement.
    const disagrees =
      deterministicResult.passed !== aiResult.passed ||
      deterministicResult.citationValid !== aiResult.citationValid ||
      deterministicResult.quoteExact     !== aiResult.quoteExact;

    if (disagrees) flags.push("VERIFIER_DISAGREEMENT");

    // Resolution: conservative wins. When verifier disagrees with comparison, use the more
    // conservative result. Never auto-approve on disagreement — always require human review.
    const conservativeStatus = disagrees
      ? moreConservative(comparison.status, "ambiguous")
      : null;

    // Final result: if the AI verifier is stricter, prefer it; never silently weaken it.
    const finalPassed = deterministicResult.passed && aiResult.passed;
    const finalResult: VerificationResult = {
      findingId:             context.findingId,
      passed:                finalPassed,
      citationValid:         deterministicResult.citationValid && aiResult.citationValid,
      quoteExact:            deterministicResult.quoteExact     && aiResult.quoteExact,
      clauseValid:           deterministicResult.clauseValid    && aiResult.clauseValid,
      unitsCompatible:       deterministicResult.unitsCompatible && aiResult.unitsCompatible,
      conditionsComplete:    deterministicResult.conditionsComplete && aiResult.conditionsComplete,
      applicabilityJustified: deterministicResult.applicabilityJustified && aiResult.applicabilityJustified,
      unsupportedClaims:     [...new Set([...deterministicResult.unsupportedClaims, ...aiResult.unsupportedClaims])],
      verifierReasoning:     aiResult.verifierReasoning,
      verifierConfidence:    Math.min(deterministicResult.verifierConfidence, aiResult.verifierConfidence),
      requiresHumanReview:   !finalPassed || disagrees || aiResult.requiresHumanReview || deterministicResult.requiresHumanReview
    };

    return {
      deterministicResult,
      aiResult,
      finalResult,
      disagreementDetected: disagrees,
      conservativeStatus,
      usedAi:  true,
      aiRunId: result.runId,
      flags
    };
  }
}
