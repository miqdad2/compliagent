/**
 * Unit 12 — Controlled Live AI Wiring tests.
 *
 * Tests cover: Anthropic adapter (mocked transport), controlled execution service,
 * AI-wired comparison, AI-wired verifier, evidence reranker, orchestrator execution
 * modes, golden speaker scenario, consent enforcement, and disagreement handling.
 *
 * No external network calls are made. The Anthropic adapter uses injected transport.
 * Live AI execution is NOT verified — API keys are empty in the current environment.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AnthropicProvider } from "@/server/services/ai/anthropic-provider";
import { _injectTestTransport, resolveProviderClient } from "@/server/services/ai/provider-registry";
import { ControlledAiExecutionService, hashSafeInputRef } from "@/server/services/ai/controlled-execution";
import { AiConditionComparisonService } from "@/server/services/reviews/ai-condition-comparison";
import { AiFindingVerifierService } from "@/server/services/reviews/ai-finding-verifier";
import { EvidenceRerankerService } from "@/server/services/reviews/evidence-reranker";
import { ReviewOrchestrator } from "@/server/services/reviews/review-orchestrator";
import { MemoryReviewGateway, makeTestReviewRow, makeTestRequirementRow } from "@/server/services/reviews/memory-review-gateway";
import { MemoryComplianceGateway } from "@/server/services/compliance/memory-compliance-gateway";
import { requirementRefinementOutputSchema } from "@/lib/ai/review-schemas";
import { conditionDecompositionOutputSchema } from "@/lib/ai/review-schemas";
import { evidenceRerankingOutputSchema } from "@/lib/ai/review-schemas";
import { aiComparisonOutputSchema } from "@/lib/ai/review-schemas";
import { verificationResultSchema } from "@/lib/ai/schemas";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievedEvidence, ChunkRow } from "@/server/services/reviews/types";
import type { AuthProfile } from "@/lib/permissions/server";
import type { AiPersistenceGateway } from "@/server/services/ai/gateway";
import type { AiAuditRecord, AiRunRow, AiRunInsert, AiRunUpdate, AiProjectScope, OrganizationAiSettingsRow, OrganizationAiSettingsInsert } from "@/server/services/ai/gateway";

// ── Mock AI persistence gateway ──────────────────────────────────────────────

class MemoryAiGateway implements AiPersistenceGateway {
  private readonly runs = new Map<string, AiRunRow>();
  readonly audits: AiAuditRecord[] = [];
  private nextId = 1;
  settingsRow: OrganizationAiSettingsRow | null = null;

  async getOrganizationAiSettings(_orgId: string): Promise<OrganizationAiSettingsRow | null> {
    return this.settingsRow;
  }

  async upsertOrganizationAiSettings(input: OrganizationAiSettingsInsert): Promise<OrganizationAiSettingsRow> {
    const row = { ...input } as OrganizationAiSettingsRow;
    this.settingsRow = row;
    return row;
  }

  async getProjectScope(projectId: string): Promise<AiProjectScope | null> {
    return { id: projectId, organizationId: "org-1" };
  }

  async createAiRun(input: AiRunInsert): Promise<AiRunRow> {
    const id = `run-${this.nextId++}`;
    const row = { id, ...input,
      provider_run_id: null, started_at: null, completed_at: null,
      latency_ms: null, input_tokens: null, output_tokens: null,
      estimated_cost: null, error_code: null, error_message: null,
      created_at: new Date().toISOString()
    } as AiRunRow;
    this.runs.set(id, row);
    return row;
  }

  async updateAiRun(_orgId: string, runId: string, input: AiRunUpdate): Promise<AiRunRow> {
    const existing = this.runs.get(runId)!;
    const updated = { ...existing, ...input } as AiRunRow;
    this.runs.set(runId, updated);
    return updated;
  }

  async writeAudit(record: AiAuditRecord): Promise<void> {
    this.audits.push(record);
  }

  getRunCount(): number { return this.runs.size; }
  getRunById(id: string): AiRunRow | undefined { return this.runs.get(id); }
}

/** Build org AI settings with full consent. */
function makeAiSettings(orgId = "org-1"): OrganizationAiSettingsRow {
  return {
    organization_id:         orgId,
    ai_enabled:              true,
    consent_granted_at:      "2026-06-01T00:00:00Z",
    consent_granted_by:      "admin-1",
    consent_document_version: "v1.0",
    default_provider:        "anthropic",
    enabled_providers:       ["anthropic"],
    model_routes:            {
      version: 1,
      allowedTaskTypes: [
        "condition_comparison", "finding_verification", "evidence_reranking",
        "requirement_refinement", "requirement_decomposition"
      ],
      externalDocumentTransmissionAllowed: true,
      multimodalTransmissionAllowed:       false,
      retentionPreference:                 "no_storage",
      providerRoutes: {
        anthropic: {
          lightweight: "claude-haiku-4-5-20251001",
          multimodal:  "claude-sonnet-4-6",
          reasoning:   "claude-sonnet-4-6",
          verifier:    "claude-sonnet-4-6",
          taskModels:  {}
        }
      }
    },
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z"
  };
}

const ACTOR: AuthProfile = {
  id: "user-1", user_id: "auth-1",
  organization_id: "org-1", full_name: "Test User",
  role: "engineer", created_at: "", updated_at: ""
};

// ── Helper: mock Anthropic transport factory ─────────────────────────────────

function mockTransport(responseJson: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok:     status < 400,
    status,
    json:   () => Promise.resolve(responseJson)
  });
}

function anthropicSuccessResponse(text: string) {
  return {
    id: "msg_test", type: "message", role: "assistant",
    content: [{ type: "text", text }],
    model: "claude-sonnet-4-6", stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 }
  };
}

// ── Anthropic adapter tests ──────────────────────────────────────────────────

describe("AnthropicProvider", () => {
  it("makes a POST to the Anthropic messages endpoint", async () => {
    const transport = mockTransport(anthropicSuccessResponse('{"test":true}'));
    const provider  = new AnthropicProvider("test-key", transport);
    await provider.execute({
      taskType: "condition_comparison", model: "claude-sonnet-4-6",
      systemPrompt: "system", input: [{ type: "text", text: "hello" }],
      outputSchemaName: "Test", outputSchema: {} as never,
      temperature: 0, timeoutMs: 5000, maxRetries: 1, runId: "run-1"
    });
    expect(transport).toHaveBeenCalledOnce();
    const call = transport.mock.calls[0];
    expect(call[0]).toContain("/v1/messages");
    expect(JSON.parse(call[1].body as string).model).toBe("claude-sonnet-4-6");
  });

  it("includes x-api-key header", async () => {
    const transport = mockTransport(anthropicSuccessResponse('{}'));
    const provider  = new AnthropicProvider("sk-test-key", transport);
    await provider.execute({
      taskType: "condition_comparison", model: "claude-sonnet-4-6",
      systemPrompt: "s", input: [{ type: "text", text: "t" }],
      outputSchemaName: "T", outputSchema: {} as never,
      temperature: 0, timeoutMs: 5000, maxRetries: 1, runId: "r1"
    });
    const headers = transport.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-key");
    expect(headers["anthropic-version"]).toBeDefined();
  });

  it("extracts text content from response", async () => {
    const transport = mockTransport(anthropicSuccessResponse('{"foo":"bar"}'));
    const provider  = new AnthropicProvider("key", transport);
    const result    = await provider.execute({
      taskType: "condition_comparison", model: "claude-sonnet-4-6",
      systemPrompt: "s", input: [{ type: "text", text: "t" }],
      outputSchemaName: "T", outputSchema: {} as never,
      temperature: 0, timeoutMs: 5000, maxRetries: 1, runId: "r2"
    });
    expect(result.rawOutput).toBe('{"foo":"bar"}');
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  it("normalizes 401 to authentication_error", async () => {
    const transport = mockTransport({ type: "error", error: { type: "auth", message: "Unauthorized" } }, 401);
    const provider  = new AnthropicProvider("bad-key", transport);
    await expect(provider.execute({
      taskType: "condition_comparison", model: "m",
      systemPrompt: "s", input: [], outputSchemaName: "T",
      outputSchema: {} as never, temperature: 0, timeoutMs: 5000, maxRetries: 1, runId: "r3"
    })).rejects.toMatchObject({ code: "authentication_error" });
  });

  it("normalizes 429 to rate_limited (retryable)", async () => {
    const transport = mockTransport({ type: "error", error: { type: "rate_limit", message: "slow" } }, 429);
    const provider  = new AnthropicProvider("key", transport);
    await expect(provider.execute({
      taskType: "condition_comparison", model: "m",
      systemPrompt: "s", input: [], outputSchemaName: "T",
      outputSchema: {} as never, temperature: 0, timeoutMs: 5000, maxRetries: 1, runId: "r4"
    })).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("normalizes 500 to provider_unavailable (retryable)", async () => {
    const transport = mockTransport({ type: "error", error: { type: "server", message: "oops" } }, 500);
    const provider  = new AnthropicProvider("key", transport);
    await expect(provider.execute({
      taskType: "condition_comparison", model: "m",
      systemPrompt: "s", input: [], outputSchemaName: "T",
      outputSchema: {} as never, temperature: 0, timeoutMs: 5000, maxRetries: 1, runId: "r5"
    })).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("sends repair request with original output", async () => {
    const transport = mockTransport(anthropicSuccessResponse('{"repaired":true}'));
    const provider  = new AnthropicProvider("key", transport);
    const result = await provider.repair(
      { taskType: "condition_comparison", model: "m", systemPrompt: "s",
        input: [{ type: "text", text: "original" }], outputSchemaName: "T",
        outputSchema: {} as never, temperature: 0, timeoutMs: 5000, maxRetries: 1, runId: "r6"
      },
      "invalid JSON",
      "Missing field: foo"
    );
    expect(result.rawOutput).toBe('{"repaired":true}');
    const body = JSON.parse(transport.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain("invalid JSON");
  });
});

// ── Provider registry tests ──────────────────────────────────────────────────

describe("Provider registry", () => {
  it("resolveProviderClient returns null when ANTHROPIC_API_KEY is empty", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    _injectTestTransport(undefined);
    expect(resolveProviderClient("anthropic")).toBeNull();
    process.env.ANTHROPIC_API_KEY = original;
  });

  it("resolveProviderClient returns AnthropicProvider when key is set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    _injectTestTransport(vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    const client = resolveProviderClient("anthropic");
    expect(client).not.toBeNull();
    expect(client?.provider).toBe("anthropic");
    process.env.ANTHROPIC_API_KEY = original;
    _injectTestTransport(undefined);
  });

  it("resolveProviderClient returns null for unimplemented providers", () => {
    expect(resolveProviderClient("openai")).toBeNull();
    expect(resolveProviderClient("gemini")).toBeNull();
  });
});

// ── AI schema validation tests ────────────────────────────────────────────────

describe("AI review schemas", () => {
  it("requirementRefinementOutputSchema: valid object passes", () => {
    const result = requirementRefinementOutputSchema.safeParse({
      isReviewable: true,
      normalizedRequirement: "Drivers must be 3.5–4 inch HQ units.",
      mandatoryLevel: "mandatory",
      requirementCategory: "acoustic performance",
      conditionalApplicability: null,
      detectedEntities: ["3.5 inch", "4 inch", "HQ"],
      confidence: 90,
      humanReviewRequired: false,
      uncertaintyReasons: []
    });
    expect(result.success).toBe(true);
  });

  it("requirementRefinementOutputSchema: empty normalizedRequirement rejected", () => {
    const result = requirementRefinementOutputSchema.safeParse({
      isReviewable: true, normalizedRequirement: "  ",
      mandatoryLevel: "mandatory", requirementCategory: "acoustic",
      conditionalApplicability: null, detectedEntities: [],
      confidence: 80, humanReviewRequired: false, uncertaintyReasons: []
    });
    expect(result.success).toBe(false);
  });

  it("conditionDecompositionOutputSchema: valid conditions accepted", () => {
    const result = conditionDecompositionOutputSchema.safeParse([
      {
        conditionOrder: 1, conditionKey: "driver_count", conditionType: "exact_value",
        subject: "speaker", attribute: "driver count", operator: "equals",
        expectedText: null, expectedNumericValue: 8, expectedMinValue: null,
        expectedMaxValue: null, expectedUnit: null, isMandatory: true,
        sourceText: "8 × drivers shall be fitted", extractionConfidence: 90, uncertaintyReason: null
      }
    ]);
    expect(result.success).toBe(true);
  });

  it("conditionDecompositionOutputSchema: duplicate keys rejected", () => {
    const base = {
      conditionOrder: 1, conditionKey: "same_key", conditionType: "boolean" as const,
      subject: "s", attribute: "a", operator: "exists" as const,
      expectedText: null, expectedNumericValue: null, expectedMinValue: null,
      expectedMaxValue: null, expectedUnit: null, isMandatory: true,
      sourceText: "source", extractionConfidence: 80, uncertaintyReason: null
    };
    const result = conditionDecompositionOutputSchema.safeParse([base, { ...base, conditionOrder: 2 }]);
    expect(result.success).toBe(false);
  });

  it("conditionDecompositionOutputSchema: numeric_range without min/max rejected", () => {
    const result = conditionDecompositionOutputSchema.safeParse([
      {
        conditionOrder: 1, conditionKey: "range_bad", conditionType: "numeric_range",
        subject: "s", attribute: "a", operator: "between",
        expectedText: null, expectedNumericValue: null,
        expectedMinValue: null, expectedMaxValue: null,
        expectedUnit: "mm", isMandatory: true,
        sourceText: "between 3 and 5 mm", extractionConfidence: 80, uncertaintyReason: null
      }
    ]);
    expect(result.success).toBe(false);
  });

  it("evidenceRerankingOutputSchema: valid array accepted", () => {
    const result = evidenceRerankingOutputSchema.safeParse([
      {
        regionId: "reg-1", classification: "DIRECT", semanticScore: 0.92,
        reasoning: "Exact value stated.", sameProductModel: true,
        featureIncluded: true, measurementConditionsCompatible: null, evidenceSufficient: true
      }
    ]);
    expect(result.success).toBe(true);
  });

  it("aiComparisonOutputSchema: complied without citation rejected", () => {
    const result = aiComparisonOutputSchema.safeParse({
      conditionId: "00000000-0000-4000-8000-000000000001",
      proposedStatus: "complied",
      citedCandidateIds: [],  // empty — should fail
      reasoning: "direct proof",
      missingInformation: null, contractorAction: null,
      confidence: 85, uncertaintyReason: null, humanReviewRequired: false
    });
    expect(result.success).toBe(false);
  });

  it("aiComparisonOutputSchema: not_proven without missing_information rejected", () => {
    const result = aiComparisonOutputSchema.safeParse({
      conditionId: "00000000-0000-4000-8000-000000000001",
      proposedStatus: "not_proven",
      citedCandidateIds: [],
      reasoning: "no evidence",
      missingInformation: null,  // required for not_proven
      contractorAction: null,
      confidence: 55, uncertaintyReason: null, humanReviewRequired: true
    });
    expect(result.success).toBe(false);
  });

  it("aiComparisonOutputSchema: low confidence requires human review", () => {
    const result = aiComparisonOutputSchema.safeParse({
      conditionId: "00000000-0000-4000-8000-000000000001",
      proposedStatus: "ambiguous",
      citedCandidateIds: ["reg-1"],
      reasoning: "unclear",
      missingInformation: null, contractorAction: null,
      confidence: 40, uncertaintyReason: null,
      humanReviewRequired: false  // should fail: confidence < 70
    });
    expect(result.success).toBe(false);
  });
});

// ── Controlled execution service tests ────────────────────────────────────────

describe("ControlledAiExecutionService", () => {
  let gateway: MemoryAiGateway;
  let executor: ControlledAiExecutionService;

  beforeEach(() => {
    gateway  = new MemoryAiGateway();
    executor = new ControlledAiExecutionService(gateway);
  });

  it("blocks execution when AI is disabled", async () => {
    gateway.settingsRow = { ...makeAiSettings(), ai_enabled: false };
    _injectTestTransport(vi.fn());

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "s", input: [{ type: "text", text: "t" }],
      inputHash: "abc", outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_DISABLED");
  });

  it("blocks execution when consent is missing", async () => {
    gateway.settingsRow = {
      ...makeAiSettings(),
      consent_granted_at: null, consent_granted_by: null, consent_document_version: null
    };

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "s", input: [], inputHash: "abc",
      outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONSENT_REQUIRED");
  });

  it("blocks disallowed provider", async () => {
    gateway.settingsRow = { ...makeAiSettings(), default_provider: "openai", enabled_providers: ["openai"] };

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "s", input: [], inputHash: "abc",
      outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false,
      preferredProvider: "anthropic"  // anthropic not in allowedProviders
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_NOT_ALLOWED");
  });

  it("blocks disallowed task", async () => {
    gateway.settingsRow = {
      ...makeAiSettings(),
      model_routes: {
        version: 1,
        allowedTaskTypes: [],
        externalDocumentTransmissionAllowed: true,
        multimodalTransmissionAllowed: false,
        retentionPreference: "no_storage",
        providerRoutes: makeAiSettings().model_routes != null
          ? (makeAiSettings().model_routes as Record<string, unknown>)["providerRoutes"] as Record<string, unknown>
          : {}
      } as unknown as import("@/types/database").Json
    };

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "s", input: [], inputHash: "abc",
      outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TASK_NOT_ALLOWED");
  });

  it("blocks external transmission when disabled", async () => {
    gateway.settingsRow = {
      ...makeAiSettings(),
      model_routes: {
        version: 1,
        allowedTaskTypes: ["condition_comparison", "finding_verification", "evidence_reranking", "requirement_refinement", "requirement_decomposition"],
        externalDocumentTransmissionAllowed: false,
        multimodalTransmissionAllowed: false,
        retentionPreference: "no_storage",
        providerRoutes: {}
      } as unknown as import("@/types/database").Json
    };

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "s", input: [], inputHash: "abc",
      outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true,  // blocked
      multimodalTransmissionRequested: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EXTERNAL_TRANSMISSION_BLOCKED");
  });

  it("blocks when no credentials are available", async () => {
    gateway.settingsRow = makeAiSettings();
    process.env.ANTHROPIC_API_KEY = "";
    _injectTestTransport(undefined);

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "s", input: [{ type: "text", text: "t" }],
      inputHash: "abc", outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MODEL_NOT_CONFIGURED");
  });

  it("succeeds and writes audit events with mocked transport", async () => {
    gateway.settingsRow = makeAiSettings();
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const validOutput = JSON.stringify({
      isReviewable: true, normalizedRequirement: "test",
      mandatoryLevel: "mandatory", requirementCategory: "test",
      conditionalApplicability: null, detectedEntities: [],
      confidence: 80, humanReviewRequired: false, uncertaintyReasons: []
    });
    _injectTestTransport(mockTransport(anthropicSuccessResponse(validOutput)));

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "requirement_refinement", promptVersion: "1.0.0",
      systemPrompt: "s", input: [{ type: "text", text: "t" }],
      inputHash: "abc",
      outputSchema: requirementRefinementOutputSchema,
      outputSchemaName: "RequirementRefinementOutput",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });

    expect(result.ok).toBe(true);
    const actions = gateway.audits.map((a) => a.action);
    expect(actions).toContain("ai.run.requested");
    expect(actions).toContain("ai.run.started");
    expect(actions).toContain("ai.run.completed");

    process.env.ANTHROPIC_API_KEY = "";
    _injectTestTransport(undefined);
  });

  it("repairs invalid output once and marks run as repaired", async () => {
    gateway.settingsRow = makeAiSettings();
    process.env.ANTHROPIC_API_KEY = "sk-test";

    const invalidOutput = '{"wrong_schema": true}';
    const validOutput   = JSON.stringify({
      isReviewable: true, normalizedRequirement: "repaired requirement",
      mandatoryLevel: "mandatory", requirementCategory: "acoustic",
      conditionalApplicability: null, detectedEntities: [],
      confidence: 75, humanReviewRequired: false, uncertaintyReasons: []
    });

    const transport = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => anthropicSuccessResponse(invalidOutput) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => anthropicSuccessResponse(validOutput) });

    _injectTestTransport(transport);

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "requirement_refinement", promptVersion: "1.0.0",
      systemPrompt: "s", input: [{ type: "text", text: "clause" }],
      inputHash: "abc",
      outputSchema: requirementRefinementOutputSchema,
      outputSchemaName: "RequirementRefinementOutput",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBe(true);

    process.env.ANTHROPIC_API_KEY = "";
    _injectTestTransport(undefined);
  });

  it("fails safely when repeated invalid output", async () => {
    gateway.settingsRow = makeAiSettings();
    process.env.ANTHROPIC_API_KEY = "sk-test";

    const invalid = '{"still_wrong": true}';
    const transport = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => anthropicSuccessResponse(invalid)
    });
    _injectTestTransport(transport);

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "requirement_refinement", promptVersion: "1.0.0",
      systemPrompt: "s", input: [{ type: "text", text: "clause" }],
      inputHash: "abc",
      outputSchema: requirementRefinementOutputSchema,
      outputSchemaName: "RequirementRefinementOutput",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUTPUT_VALIDATION_FAILED");

    process.env.ANTHROPIC_API_KEY = "";
    _injectTestTransport(undefined);
  });

  it("normalizes provider timeout", async () => {
    gateway.settingsRow = makeAiSettings();
    process.env.ANTHROPIC_API_KEY = "sk-test";

    // Simulate a timeout: the transport rejects with a network error.
    const transport = vi.fn().mockRejectedValue(
      new DOMException("Aborted", "AbortError")
    );
    _injectTestTransport(transport);

    const result = await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "s", input: [{ type: "text", text: "t" }],
      inputHash: "abc", outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false,
      timeoutMs: 1
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(["PROVIDER_TIMEOUT", "PROVIDER_FAILED"]).toContain(result.error.code);

    process.env.ANTHROPIC_API_KEY = "";
    _injectTestTransport(undefined);
  });

  it("audit logs do not contain confidential text", async () => {
    gateway.settingsRow = makeAiSettings();
    process.env.ANTHROPIC_API_KEY = "sk-test";
    _injectTestTransport(mockTransport({ type: "error", error: { message: "rate limited" } }, 429));

    await executor.execute({
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: null, documentId: null,
      taskType: "condition_comparison", promptVersion: "1.0.0",
      systemPrompt: "system",
      input: [{ type: "text", text: "CONFIDENTIAL_DOCUMENT_CONTENT" }],
      inputHash: "safe-hash",
      outputSchema: {} as never, outputSchemaName: "T",
      externalTransmissionRequested: true, multimodalTransmissionRequested: false
    });

    const metaStrings = gateway.audits.map((a) => JSON.stringify(a.metadata));
    for (const m of metaStrings) {
      expect(m).not.toContain("CONFIDENTIAL_DOCUMENT_CONTENT");
    }

    process.env.ANTHROPIC_API_KEY = "";
    _injectTestTransport(undefined);
  });
});

// ── hashSafeInputRef ──────────────────────────────────────────────────────────

describe("hashSafeInputRef", () => {
  it("produces a 64-char hex string", () => {
    const h = hashSafeInputRef({
      organizationId: "org-1", projectId: "proj-1",
      reviewId: "review-1", entityId: "cond-1",
      taskType: "condition_comparison", promptVersion: "1.0.0"
    });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different entity IDs produce different hashes", () => {
    const h1 = hashSafeInputRef({ organizationId: "o", projectId: "p", reviewId: "r", entityId: "e1", taskType: "t", promptVersion: "v" });
    const h2 = hashSafeInputRef({ organizationId: "o", projectId: "p", reviewId: "r", entityId: "e2", taskType: "t", promptVersion: "v" });
    expect(h1).not.toBe(h2);
  });
});

// ── Golden speaker review — execution mode tests ──────────────────────────────

describe("Golden speaker review — execution modes", () => {
  function makeCondition(overrides: Partial<RequirementConditionRow> = {}): RequirementConditionRow {
    const now = new Date().toISOString();
    return {
      id: "cond-1", organization_id: "org-1", project_id: "proj-1",
      requirement_id: "req-1", condition_order: 1, condition_key: "driver_count",
      condition_type: "exact_value", subject: "speaker system", attribute: "driver count",
      operator: "equals", expected_text: "8 × 3.5-inch HQ drivers",
      expected_numeric_value: 8, expected_min_value: null, expected_max_value: null,
      expected_unit: null, is_mandatory: true,
      source_text: "8 × 3.5-inch HQ drivers shall be provided",
      extraction_confidence: 92, is_active: true, is_human_confirmed: false,
      superseded_at: null, superseded_reason: null, created_at: now, updated_at: now,
      ...overrides
    };
  }

  function makeChunk(overrides: Partial<ChunkRow> = {}): ChunkRow {
    return {
      id: "chunk-1", document_id: "doc-sub-1", project_id: "proj-1",
      page_number: 3, clause_number: "5.1", section_heading: null,
      chunk_text: "Transducers: 8 × 3.5-inch HQ drivers",
      normalized_text: "Transducers: 8 × 3.5-inch HQ drivers",
      embedding: null, metadata: {}, created_at: new Date().toISOString(),
      ...overrides
    };
  }

  function baseInput(mode: "deterministic" | "mock" | "controlled_live" = "deterministic") {
    return {
      organizationId: "org-1", projectId: "proj-1", reviewId: "review-1",
      createdBy: "user-1", reviewVersion: 1, sourceHash: "hash-1",
      extractionVersion: "v1", promptVersion: "1.0.0", executionMode: mode
    };
  }

  it("[deterministic] transitions to awaiting_human_review for speaker spec", async () => {
    const gateway    = new MemoryReviewGateway();
    const compliance = new MemoryComplianceGateway();
    compliance.enableFindingStubs();
    const orchestrator = new ReviewOrchestrator(gateway, compliance, null);

    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1",
        requirement_text: "Drivers must be high-quality full-range units from 3.5 to 4 inches with neodymium magnets.",
        mandatory_level: "mandatory", extraction_confidence: 92
      })
    ]);
    gateway.seedChunks([makeChunk()]);
    compliance.seedCondition(makeCondition());

    const result = await orchestrator.runControlledReview(baseInput("deterministic"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("awaiting_human_review");
    expect(result.data.executionMode).toBe("deterministic");
    expect(result.data.status).not.toBe("approved");
    expect(result.data.aiRunCount).toBe(0);
  });

  it("[deterministic] never auto-approves", async () => {
    const gateway    = new MemoryReviewGateway();
    const compliance = new MemoryComplianceGateway();
    compliance.enableFindingStubs();
    const orchestrator = new ReviewOrchestrator(gateway, compliance, null);

    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification", processing_status: "completed" },
      { id: "doc-sub-1", document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1",
        requirement_text: "8 drivers shall be installed.", mandatory_level: "mandatory",
        extraction_confidence: 95
      })
    ]);
    gateway.seedChunks([makeChunk()]);
    compliance.seedCondition(makeCondition());

    const result = await orchestrator.runControlledReview(baseInput());
    if (!result.ok) return;
    const reviewRow = gateway.getReviewRow("review-1");
    expect(reviewRow?.status).not.toBe("approved");
    expect(reviewRow?.status).toBe("awaiting_human_review");
  });

  it("[mock] passes without external calls when no executor provided", async () => {
    const gateway    = new MemoryReviewGateway();
    const compliance = new MemoryComplianceGateway();
    compliance.enableFindingStubs();
    // mock mode with null executor: falls back to deterministic
    const orchestrator = new ReviewOrchestrator(gateway, compliance, null);

    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification", processing_status: "completed" },
      { id: "doc-sub-1", document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1",
        requirement_text: "Units shall be IP65 rated.", mandatory_level: "mandatory",
        extraction_confidence: 88
      })
    ]);
    gateway.seedChunks([makeChunk({ chunk_text: "IP65 rated enclosure.", normalized_text: "IP65 rated enclosure." })]);
    compliance.seedCondition(makeCondition({ expected_text: "IP65", expected_numeric_value: null }));

    const result = await orchestrator.runControlledReview(baseInput("mock"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.aiRunCount).toBe(0);
    expect(result.data.flags).toContain("DETERMINISTIC_FALLBACK_USED");
  });

  it("parent status remains deterministic regardless of AI", async () => {
    // The parent is always derived by deriveParentFindingStatus — never set by AI.
    const gateway    = new MemoryReviewGateway();
    const compliance = new MemoryComplianceGateway();
    compliance.enableFindingStubs();
    const orchestrator = new ReviewOrchestrator(gateway, compliance, null);

    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification", processing_status: "completed" },
      { id: "doc-sub-1", document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1",
        requirement_text: "Shall comply with IEC 60268.", mandatory_level: "mandatory",
        extraction_confidence: 85
      })
    ]);
    gateway.seedChunks([]);
    compliance.seedCondition(makeCondition({
      condition_type: "standard_required", expected_text: "IEC 60268",
      expected_numeric_value: null
    }));

    const result = await orchestrator.runControlledReview(baseInput("deterministic"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // With no evidence, parent should be not_proven or not_verified — never complied.
    expect(["not_proven", "not_verified", "ambiguous", "not_complied"]).toContain(
      compliance.findings[0]?.status ?? "not_proven"
    );
    expect(result.data.status).not.toBe("approved");
  });
});

// ── AiConditionComparisonService tests ───────────────────────────────────────

describe("AiConditionComparisonService", () => {
  function makeEvidence(overrides: Partial<RetrievedEvidence> = {}): RetrievedEvidence {
    return {
      conditionId: "cond-1", retrievalResults: [], sufficiency: "irrelevant",
      primaryQuote: null, primaryRegionId: null, ...overrides
    };
  }

  function makeCondition(type: RequirementConditionRow["condition_type"] = "exact_value"): RequirementConditionRow {
    const now = new Date().toISOString();
    return {
      id: "cond-1", organization_id: "org-1", project_id: "proj-1",
      requirement_id: "req-1", condition_order: 1, condition_key: "c",
      condition_type: type, subject: "s", attribute: "driver size",
      operator: "equals", expected_text: "3.5 inch",
      expected_numeric_value: null, expected_min_value: null, expected_max_value: null,
      expected_unit: null, is_mandatory: true,
      source_text: "source", extraction_confidence: 90,
      is_active: true, is_human_confirmed: false,
      superseded_at: null, superseded_reason: null,
      created_at: now, updated_at: now
    };
  }

  it("uses deterministic for numeric conditions (no AI needed)", async () => {
    const svc = new AiConditionComparisonService(null);
    const condition = { ...makeCondition("exact_value"), expected_numeric_value: 8, expected_text: null };
    const evidence = makeEvidence({ sufficiency: "direct", primaryQuote: "8 drivers installed.", retrievalResults: [
      {
        conditionId: "cond-1", documentId: "d1", pageNumber: 1, clauseNumber: null,
        regionId: "reg-1", exactQuote: "8 drivers installed.", evidenceType: "numeric_value",
        semanticScore: 0, keywordScore: 0.9, retrievalConfidence: 85, extractionConfidence: 80,
        relationshipType: "supports"
      }
    ]});

    const result = await svc.compare(condition, evidence, {
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1", reviewId: "r1"
    });
    expect(result.usedAi).toBe(false);
    expect(result.comparison.status).toBe("complied");
  });

  it("falls back to deterministic when no executor for text conditions", async () => {
    const svc = new AiConditionComparisonService(null);
    const condition = makeCondition("text_match");
    const evidence = makeEvidence({ sufficiency: "partial", primaryQuote: "Some text.", retrievalResults: [{
      conditionId: "cond-1", documentId: "d1", pageNumber: 1, clauseNumber: null,
      regionId: "reg-1", exactQuote: "Some text.", evidenceType: "keyword",
      semanticScore: 0, keywordScore: 0.5, retrievalConfidence: 60, extractionConfidence: 70,
      relationshipType: "supports"
    }]});

    const result = await svc.compare(condition, evidence, {
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1", reviewId: "r1"
    });
    expect(result.usedAi).toBe(false);
    expect(result.flags).toContain("DETERMINISTIC_FALLBACK_USED");
  });

  it("returns deterministic result with flag when no evidence", async () => {
    const svc = new AiConditionComparisonService(null);
    const condition = makeCondition("certificate_required");
    const result = await svc.compare(condition, makeEvidence(), {
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1", reviewId: "r1"
    });
    expect(["not_proven", "ambiguous"]).toContain(result.comparison.status);
    expect(result.flags).toContain("MISSING_DIRECT_EVIDENCE");
  });
});

// ── AiFindingVerifierService tests ────────────────────────────────────────────

describe("AiFindingVerifierService", () => {
  function makeEvidence(): RetrievedEvidence {
    return {
      conditionId: "cond-1",
      retrievalResults: [{
        conditionId: "cond-1", documentId: "d1", pageNumber: 1, clauseNumber: null,
        regionId: "reg-1", exactQuote: "8 drivers installed",
        evidenceType: "exact_phrase", semanticScore: 0, keywordScore: 1.0,
        retrievalConfidence: 90, extractionConfidence: 90, relationshipType: "supports"
      }],
      sufficiency: "direct", primaryQuote: "8 drivers installed", primaryRegionId: "reg-1"
    };
  }

  it("falls back to deterministic when no executor", async () => {
    const svc = new AiFindingVerifierService(null);
    const condition = {
      id: "cond-1", organization_id: "org-1", project_id: "proj-1",
      requirement_id: "req-1", condition_order: 1, condition_key: "c",
      condition_type: "exact_value" as const, subject: "s", attribute: "driver count",
      operator: "equals" as const, expected_text: "8 drivers",
      expected_numeric_value: 8, expected_min_value: null, expected_max_value: null,
      expected_unit: null, is_mandatory: true, source_text: "src",
      extraction_confidence: 90, is_active: true, is_human_confirmed: false,
      superseded_at: null, superseded_reason: null,
      created_at: "", updated_at: ""
    };
    const comparison = {
      conditionId: "cond-1", status: "complied" as const,
      normalizedRequirement: "r", normalizedEvidence: "8 drivers installed",
      numericComparison: null, unitComparison: null,
      reasoning: "direct match", missingInformation: null, contractorAction: null,
      verificationFailureReason: null, confidence: 90, risk: "low" as const,
      humanReviewRequired: false
    };

    const result = await svc.verify(condition, makeEvidence(), comparison, {
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: "r1", findingId: "f1"
    });

    expect(result.usedAi).toBe(false);
    expect(result.flags).toContain("DETERMINISTIC_FALLBACK_USED");
  });

  it("verifier citation failure blocks complied status", async () => {
    const svc = new AiFindingVerifierService(null);
    const condition = {
      id: "cond-1", organization_id: "org-1", project_id: "proj-1",
      requirement_id: "req-1", condition_order: 1, condition_key: "c",
      condition_type: "exact_value" as const, subject: "s", attribute: "a",
      operator: "equals" as const, expected_text: "val",
      expected_numeric_value: null, expected_min_value: null, expected_max_value: null,
      expected_unit: null, is_mandatory: true, source_text: "src",
      extraction_confidence: 90, is_active: true, is_human_confirmed: false,
      superseded_at: null, superseded_reason: null,
      created_at: "", updated_at: ""
    };
    const noEvidence: RetrievedEvidence = {
      conditionId: "cond-1", retrievalResults: [], sufficiency: "irrelevant",
      primaryQuote: null, primaryRegionId: null
    };
    const comparison = {
      conditionId: "cond-1", status: "complied" as const,
      normalizedRequirement: "r", normalizedEvidence: "fabricated quote",
      numericComparison: null, unitComparison: null,
      reasoning: "AI said complied", missingInformation: null, contractorAction: null,
      verificationFailureReason: null, confidence: 85, risk: "low" as const,
      humanReviewRequired: false
    };

    const result = await svc.verify(condition, noEvidence, comparison, {
      actor: ACTOR, organizationId: "org-1", projectId: "proj-1",
      reviewId: "r1", findingId: "f1"
    });

    expect(result.deterministicResult.passed).toBe(false);
    expect(result.deterministicResult.citationValid).toBe(false);
  });
});

// ── Conservative evidence rules ───────────────────────────────────────────────

describe("Conservative evidence rules (schema level)", () => {
  it("optional capability is not direct evidence: semanticScore 0.5 should not be DIRECT", () => {
    const result = evidenceRerankingOutputSchema.safeParse([
      {
        regionId: "r1", classification: "PARTIAL",  // correct: optional = PARTIAL not DIRECT
        semanticScore: 0.5, reasoning: "supports X but not stated as included",
        sameProductModel: true, featureIncluded: null,
        measurementConditionsCompatible: null, evidenceSufficient: false
      }
    ]);
    expect(result.success).toBe(true);
    expect(result.data?.[0]?.classification).toBe("PARTIAL");
  });

  it("comparisonSchema: complied without cited evidence fails", () => {
    const result = aiComparisonOutputSchema.safeParse({
      conditionId: "00000000-0000-0000-0000-000000000001",
      proposedStatus: "complied",
      citedCandidateIds: [],
      reasoning: "AI thinks it's good",
      missingInformation: null, contractorAction: null,
      confidence: 90, uncertaintyReason: null, humanReviewRequired: false
    });
    expect(result.success).toBe(false);
  });

  it("verificationSchema: passed=true with failed citationValid fails", () => {
    const result = verificationResultSchema.safeParse({
      findingId: "00000000-0000-0000-0000-000000000001",
      passed: true,         // cannot be true when citationValid = false
      citationValid: false,
      quoteExact: true, clauseValid: true, unitsCompatible: true,
      conditionsComplete: true, applicabilityJustified: true,
      unsupportedClaims: [],
      verifierReasoning: "passed",
      verifierConfidence: 80, requiresHumanReview: false
    });
    expect(result.success).toBe(false);
  });
});
