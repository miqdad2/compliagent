/**
 * AI-assisted condition comparison service.
 *
 * Uses deterministic logic first for numeric and evidence-presence conditions.
 * Invokes AI only for conditions that deterministic logic cannot conclusively resolve:
 *   text_match, standard_required, certificate_required, feature_required,
 *   material_required, configuration_required, conditional_requirement.
 *
 * Conservative fallback: when AI is unavailable or fails, the condition is left
 * as "ambiguous" (not auto-resolved) and requires human review.
 */
import { z } from "zod";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievedEvidence } from "./types";
import type { ComparisonResult } from "@/lib/ai/schemas";
import { ConditionComparisonService } from "./condition-comparison";
import { aiComparisonOutputSchema, type AiComparisonOutput, type ConfidenceFlag } from "@/lib/ai/review-schemas";
import { AI_TASK } from "@/lib/ai/tasks";
import { conditionComparisonPrompt } from "@/lib/prompts/condition-review";
import { hashSafeInputRef, type ControlledAiExecutionService } from "@/server/services/ai/controlled-execution";
import type { AuthProfile } from "@/lib/permissions/server";
import type { ConditionEvaluationStatus } from "@/lib/compliance/condition-schemas";

/** Condition types that the deterministic layer handles conclusively. */
const DETERMINISTIC_TYPES: Set<RequirementConditionRow["condition_type"]> = new Set([
  "numeric_minimum", "numeric_maximum", "numeric_range", "exact_value", "boolean"
]);

/** Condition types that need AI reasoning. */
const AI_TYPES: Set<RequirementConditionRow["condition_type"]> = new Set([
  "text_match", "standard_required", "certificate_required", "feature_required",
  "material_required", "configuration_required", "conditional_requirement"
]);

export type AiComparisonContext = {
  actor:          AuthProfile;
  organizationId: string;
  projectId:      string;
  reviewId:       string;
};

export type ComparisonOutcome = {
  comparison:  ComparisonResult;
  usedAi:      boolean;
  aiRunId:     string | null;
  flags:       ConfidenceFlag[];
};

export class AiConditionComparisonService {
  private readonly deterministic = new ConditionComparisonService();

  constructor(private readonly executor: ControlledAiExecutionService | null) {}

  async compare(
    condition: RequirementConditionRow,
    evidence: RetrievedEvidence,
    context: AiComparisonContext
  ): Promise<ComparisonOutcome> {
    // Always run deterministic first.
    const deterministicResult = this.deterministic.compare(condition, evidence);

    // If the condition type is deterministic and the result is conclusive, return it.
    if (DETERMINISTIC_TYPES.has(condition.condition_type)) {
      const conclusive = ["complied", "not_complied", "exceeds_requirement", "not_proven"].includes(
        deterministicResult.status
      );
      if (conclusive) {
        return { comparison: deterministicResult, usedAi: false, aiRunId: null, flags: [] };
      }
    }

    // For text/conditional types, or when deterministic returns ambiguous, try AI.
    if (AI_TYPES.has(condition.condition_type) || deterministicResult.status === "ambiguous") {
      if (!this.executor || evidence.retrievalResults.length === 0) {
        // No executor or no evidence: stay with deterministic result, flag it.
        const flags: ConfidenceFlag[] = ["DETERMINISTIC_FALLBACK_USED"];
        if (evidence.retrievalResults.length === 0) flags.push("MISSING_DIRECT_EVIDENCE");
        return { comparison: deterministicResult, usedAi: false, aiRunId: null, flags };
      }

      const aiResult = await this._invokeAiComparison(condition, evidence, context, deterministicResult);
      if (aiResult) {
        return aiResult;
      }

      // AI failed: fall back to deterministic, flag it.
      return { comparison: deterministicResult, usedAi: false, aiRunId: null, flags: ["DETERMINISTIC_FALLBACK_USED"] };
    }

    return { comparison: deterministicResult, usedAi: false, aiRunId: null, flags: [] };
  }

  private async _invokeAiComparison(
    condition: RequirementConditionRow,
    evidence: RetrievedEvidence,
    context: AiComparisonContext,
    deterministicFallback: ComparisonResult
  ): Promise<ComparisonOutcome | null> {
    // Build a minimal user message — only excerpts, not full documents.
    const candidateList = evidence.retrievalResults
      .slice(0, 5)
      .map((r) => `[${r.regionId}] page ${r.pageNumber}: "${r.exactQuote.slice(0, 300)}"`)
      .join("\n");

    const userMessage = [
      `Condition ID: ${condition.id}`,
      `Subject: ${condition.subject}`,
      `Attribute: ${condition.attribute}`,
      `Operator: ${condition.operator}`,
      `Expected: ${condition.expected_text ?? condition.expected_numeric_value ?? ""}`,
      `Source text: "${condition.source_text.slice(0, 300)}"`,
      `Evidence candidates:`,
      candidateList || "(none)"
    ].join("\n");

    const inputHash = hashSafeInputRef({
      organizationId: context.organizationId,
      projectId:      context.projectId,
      reviewId:       context.reviewId,
      entityId:       condition.id,
      taskType:       AI_TASK.CONDITION_COMPARISON,
      promptVersion:  conditionComparisonPrompt.version
    });

    const result = await this.executor!.execute({
      actor:                          context.actor,
      organizationId:                 context.organizationId,
      projectId:                      context.projectId,
      reviewId:                       context.reviewId,
      documentId:                     null,
      taskType:                       AI_TASK.CONDITION_COMPARISON,
      promptVersion:                  conditionComparisonPrompt.version,
      systemPrompt:                   conditionComparisonPrompt.systemPrompt,
      input:                          [{ type: "text", text: userMessage }],
      inputHash,
      outputSchema:                   aiComparisonOutputSchema,
      outputSchemaName:               "AiComparisonOutput",
      temperature:                    0,
      timeoutMs:                      30_000,
      externalTransmissionRequested:  true,
      multimodalTransmissionRequested: false
    });

    if (!result.ok) {
      return null;
    }

    const aiOut: AiComparisonOutput = result.data;
    const flags: ConfidenceFlag[] = ["AI_COMPARISON_USED"];
    if (result.repaired) flags.push("REPAIR_ATTEMPTED");
    if (aiOut.confidence < 70) flags.push("LOW_COMPARISON_CONFIDENCE");

    // Map AiComparisonOutput → ComparisonResult.
    const comparison: ComparisonResult = {
      conditionId:           condition.id,
      status:                aiOut.proposedStatus as ConditionEvaluationStatus,
      normalizedRequirement: `${condition.subject}: ${condition.attribute} ${condition.operator} ${condition.expected_text ?? ""}`.trim(),
      normalizedEvidence:    evidence.retrievalResults.find((r) => aiOut.citedCandidateIds.includes(r.regionId))?.exactQuote ?? null,
      numericComparison:     null,
      unitComparison:        null,
      reasoning:             aiOut.reasoning,
      missingInformation:    aiOut.missingInformation,
      contractorAction:      aiOut.contractorAction,
      verificationFailureReason: null,
      confidence:            aiOut.confidence,
      risk:                  aiOut.confidence < 60 ? "high" : aiOut.confidence < 75 ? "medium" : "low",
      humanReviewRequired:   aiOut.humanReviewRequired
    };

    // Conservative override: if AI is more optimistic than deterministic on a text type,
    // require human review regardless.
    const statusOrder = ["not_verified", "not_complied", "not_proven", "ambiguous", "partially_complied", "complied", "exceeds_requirement"];
    const aiIdx = statusOrder.indexOf(comparison.status);
    const detIdx = statusOrder.indexOf(deterministicFallback.status);
    if (aiIdx > detIdx && deterministicFallback.status !== "ambiguous") {
      comparison.humanReviewRequired = true;
    }

    return { comparison, usedAi: true, aiRunId: result.runId, flags };
  }
}
