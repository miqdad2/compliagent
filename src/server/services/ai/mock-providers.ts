import { z } from "zod";
import {
  AiProviderError,
  type AiProviderClient,
  type AiProviderRequest,
  type AiProviderTransportResponse
} from "@/lib/ai/provider-interface";
import type { AiProvider } from "@/lib/ai/provider";
import type { AiModelTier } from "@/lib/ai/tasks";

export const mockProviderBehaviors = [
  "success",
  "invalid_json_then_repair",
  "invalid_json_persistent",
  "timeout",
  "provider_failure"
] as const;
export type MockProviderBehavior = (typeof mockProviderBehaviors)[number];

export const mockAiOutputSchema = z
  .object({
    ok: z.literal(true),
    executionMode: z.literal("mock"),
    taskType: z.string().min(1),
    modelTier: z.enum(["lightweight", "multimodal", "reasoning", "verifier"]),
    model: z.string().min(1),
    deterministicResult: z.literal("MOCK_VALIDATED")
  })
  .strict();

export type MockAiOutput = z.infer<typeof mockAiOutputSchema>;

function mockUsage(runId: string, tier: AiModelTier): AiProviderTransportResponse["usage"] {
  const tokens = { lightweight: 12, multimodal: 24, reasoning: 36, verifier: 20 }[tier];
  return {
    inputTokens: tokens,
    outputTokens: 8,
    estimatedCost: 0,
    latencyMs: 5,
    providerRunId: `mock-${tier}-${runId}`
  };
}

abstract class BaseMockProvider implements AiProviderClient {
  abstract readonly tier: AiModelTier;

  constructor(
    public readonly provider: AiProvider,
    private readonly behavior: MockProviderBehavior
  ) {}

  async execute<T>(request: AiProviderRequest<T>): Promise<AiProviderTransportResponse> {
    if (this.behavior === "timeout") {
      throw new AiProviderError(this.provider, "timeout", "Simulated mock timeout.", true);
    }
    if (this.behavior === "provider_failure") {
      throw new AiProviderError(this.provider, "provider_unavailable", "Simulated mock provider failure.", true, 503);
    }

    return {
      rawOutput:
        this.behavior === "invalid_json_then_repair" || this.behavior === "invalid_json_persistent"
          ? "{invalid mock json"
          : this.validOutput(request),
      usage: mockUsage(request.runId, this.tier)
    };
  }

  async repair<T>(request: AiProviderRequest<T>): Promise<AiProviderTransportResponse> {
    return {
      rawOutput: this.behavior === "invalid_json_persistent" ? "{still invalid" : this.validOutput(request),
      usage: mockUsage(request.runId, this.tier)
    };
  }

  private validOutput<T>(request: AiProviderRequest<T>) {
    return JSON.stringify({
      ok: true,
      executionMode: "mock",
      taskType: request.taskType,
      modelTier: this.tier,
      model: request.model,
      deterministicResult: "MOCK_VALIDATED"
    } satisfies MockAiOutput);
  }
}

export class MockLightweightProvider extends BaseMockProvider {
  readonly tier = "lightweight" as const;
}

export class MockMultimodalProvider extends BaseMockProvider {
  readonly tier = "multimodal" as const;
}

export class MockReasoningProvider extends BaseMockProvider {
  readonly tier = "reasoning" as const;
}

export class MockVerifierProvider extends BaseMockProvider {
  readonly tier = "verifier" as const;
}

export class MockAiProviderRegistry {
  get(tier: AiModelTier, provider: AiProvider, behavior: MockProviderBehavior): AiProviderClient {
    switch (tier) {
      case "lightweight":
        return new MockLightweightProvider(provider, behavior);
      case "multimodal":
        return new MockMultimodalProvider(provider, behavior);
      case "reasoning":
        return new MockReasoningProvider(provider, behavior);
      case "verifier":
        return new MockVerifierProvider(provider, behavior);
    }
  }
}
