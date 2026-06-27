import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { normalizeProviderError } from "@/lib/ai/provider-interface";
import { resolveAiTaskRoute, type OrganizationAiConfig } from "@/lib/ai/router";
import {
  aiRunMetadataSchema,
  comparisonResultSchema,
  retrievalResultSchema,
  verificationResultSchema
} from "@/lib/ai/schemas";
import { AI_TASK } from "@/lib/ai/tasks";
import { parseAndValidateAiJson } from "@/lib/ai/validation";
import { compareNumericRange, compareRequiredEvidencePresence } from "@/lib/compliance/deterministic-comparison";
import { deriveParentFindingStatus } from "@/lib/compliance/parent-finding";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  review: "33333333-3333-4333-8333-333333333333",
  document: "44444444-4444-4444-8444-444444444444",
  condition: "55555555-5555-4555-8555-555555555555",
  region: "66666666-6666-4666-8666-666666666666",
  finding: "77777777-7777-4777-8777-777777777777",
  user: "88888888-8888-4888-8888-888888888888"
};

const routingConfig: OrganizationAiConfig = {
  enabled: true,
  consentGranted: true,
  defaultProvider: "anthropic",
  providers: {
    anthropic: {
      enabled: true,
      models: {
        lightweight: "classify-model",
        multimodal: "vision-model",
        reasoning: "reasoning-model",
        verifier: "verifier-model"
      }
    },
    openai: {
      enabled: true,
      models: { reasoning: "alternate-reasoning-model" }
    }
  }
};

describe("controlled AI routing", () => {
  it("selects only an enabled organization provider after consent", () => {
    expect(resolveAiTaskRoute(AI_TASK.CONDITION_COMPARISON, routingConfig)).toMatchObject({
      provider: "anthropic",
      model: "reasoning-model",
      modelTier: "reasoning"
    });
    expect(resolveAiTaskRoute(AI_TASK.CONDITION_COMPARISON, routingConfig, "openai").model).toBe(
      "alternate-reasoning-model"
    );
  });

  it("routes multimodal understanding and independent verification to separate model tiers", () => {
    expect(resolveAiTaskRoute(AI_TASK.DOCUMENT_UNDERSTANDING, routingConfig).model).toBe("vision-model");
    expect(resolveAiTaskRoute(AI_TASK.FINDING_VERIFICATION, routingConfig).model).toBe("verifier-model");
  });

  it("blocks routing without organization consent", () => {
    expect(() => resolveAiTaskRoute(AI_TASK.PROJECT_CHAT, { ...routingConfig, consentGranted: false })).toThrow(
      /consent/i
    );
  });
});

describe("AI structured result schemas", () => {
  it("validates complete AI run metadata", () => {
    expect(
      aiRunMetadataSchema.parse({
        id: ids.region,
        organizationId: ids.organization,
        projectId: ids.project,
        reviewId: ids.review,
        documentId: ids.document,
        taskType: "condition_comparison",
        provider: "anthropic",
        model: "reasoning-model",
        promptVersion: "condition-comparison@1.0.0",
        providerRunId: "provider-run-1",
        inputHash: "a".repeat(64),
        status: "completed",
        startedAt: "2026-06-20T10:00:00.000Z",
        completedAt: "2026-06-20T10:00:01.000Z",
        latencyMs: 1000,
        inputTokens: 120,
        outputTokens: 60,
        estimatedCost: 0.01,
        validationStatus: "passed",
        verificationStatus: "pending",
        errorCode: null,
        errorMessage: null,
        createdBy: ids.user,
        createdAt: "2026-06-20T10:00:00.000Z"
      }).status
    ).toBe("completed");
  });

  it("validates page- and region-backed retrieval results", () => {
    expect(
      retrievalResultSchema.parse({
        conditionId: ids.condition,
        documentId: ids.document,
        pageNumber: 3,
        clauseNumber: "2.2.1 A.1(b)",
        regionId: ids.region,
        exactQuote: '3.5" drivers',
        evidenceType: "technical_value",
        semanticScore: 0.92,
        keywordScore: 1,
        retrievalConfidence: 96,
        extractionConfidence: 99,
        relationshipType: "supports"
      }).exactQuote
    ).toBe('3.5" drivers');
  });

  it("validates condition comparison results and requires evidence for compliance", () => {
    const valid = comparisonResultSchema.parse({
      conditionId: ids.condition,
      status: "complied",
      normalizedRequirement: "driver size between 3.5 and 4 inches",
      normalizedEvidence: "driver size 3.5 inches",
      numericComparison: {
        operator: "range",
        requiredValue: null,
        requiredMin: 3.5,
        requiredMax: 4,
        proposedValue: 3.5,
        passed: true
      },
      unitComparison: { requiredUnit: "inch", proposedUnit: "inch", compatible: true, conversionApplied: false },
      reasoning: "The stated value is inside the required range.",
      missingInformation: null,
      contractorAction: null,
      verificationFailureReason: null,
      confidence: 96,
      risk: "low",
      humanReviewRequired: false
    });
    expect(valid.status).toBe("complied");
  });

  it("validates independent verification results", () => {
    expect(
      verificationResultSchema.parse({
        findingId: ids.finding,
        passed: true,
        citationValid: true,
        quoteExact: true,
        clauseValid: true,
        unitsCompatible: true,
        conditionsComplete: true,
        applicabilityJustified: true,
        unsupportedClaims: [],
        verifierReasoning: "Every cited field was independently checked.",
        verifierConfidence: 95,
        requiresHumanReview: false
      }).passed
    ).toBe(true);
  });
});

describe("condition comparison and parent derivation", () => {
  it("derives partial compliance for the driver example", () => {
    const result = deriveParentFindingStatus([
      { id: ids.condition, status: "complied", isMandatory: true },
      { id: "99999999-9999-4999-8999-999999999999", status: "not_proven", isMandatory: true },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "not_proven", isMandatory: true }
    ]);
    expect(result.status).toBe("partially_complied");
  });

  it("does not equate values measured under different conditions", () => {
    expect(
      compareNumericRange({
        requiredMin: 90,
        requiredMax: 110,
        requiredUnit: "dB",
        requiredMeasurementCondition: "at 1 m",
        proposedValue: 100,
        proposedUnit: "dB",
        proposedMeasurementCondition: "at 25 m"
      }).status
    ).toBe("ambiguous");
  });

  it("marks a missing certificate as not proven", () => {
    expect(compareRequiredEvidencePresence({ evidenceKind: "certificate", expected: "IEC 62368-1", exactEvidence: null })).toMatchObject({
      status: "not_proven",
      humanReviewRequired: true
    });
  });
});

describe("AI trust boundaries", () => {
  it("rejects verification that passes with an unsupported citation", () => {
    const result = verificationResultSchema.safeParse({
      findingId: ids.finding,
      passed: true,
      citationValid: false,
      quoteExact: false,
      clauseValid: true,
      unitsCompatible: true,
      conditionsComplete: true,
      applicabilityJustified: true,
      unsupportedClaims: ["The cited quote does not exist in the region."],
      verifierReasoning: "Citation could not be reproduced.",
      verifierConfidence: 90,
      requiresHumanReview: true
    });
    expect(result.success).toBe(false);
  });

  it("rejects a low-confidence comparison without human review", () => {
    const result = comparisonResultSchema.safeParse({
      conditionId: ids.condition,
      status: "ambiguous",
      normalizedRequirement: "SPL measured at 1 m",
      normalizedEvidence: "SPL measured at 25 m",
      numericComparison: null,
      unitComparison: null,
      reasoning: "Measurement conditions differ.",
      missingInformation: "Provide the SPL at 1 m.",
      contractorAction: "Submit like-for-like test data.",
      verificationFailureReason: null,
      confidence: 60,
      risk: "high",
      humanReviewRequired: false
    });
    expect(result.success).toBe(false);
  });

  it("normalizes provider errors without leaking provider-specific shapes", () => {
    const error = normalizeProviderError("openai", { status: 429, message: "quota" });
    expect(error).toMatchObject({ provider: "openai", code: "rate_limited", retryable: true, statusCode: 429 });
  });

  it("repairs and validates invalid AI JSON exactly once", async () => {
    const repair = vi.fn().mockResolvedValue('{"status":"not_proven"}');
    const result = await parseAndValidateAiJson("{bad json", z.object({ status: z.literal("not_proven") }), repair);
    expect(result).toEqual({ data: { status: "not_proven" }, repaired: true });
    expect(repair).toHaveBeenCalledOnce();
  });
});
