import { afterEach, describe, expect, it } from "vitest";
import { configuredAiProvider, getAiRuntimeConfig } from "@/lib/ai/provider";

const originalAiProvider = process.env.AI_PROVIDER;

afterEach(() => {
  if (originalAiProvider === undefined) {
    delete process.env.AI_PROVIDER;
  } else {
    process.env.AI_PROVIDER = originalAiProvider;
  }
});

describe("AI provider configuration", () => {
  it("falls back to deterministic review when AI_PROVIDER is empty", () => {
    process.env.AI_PROVIDER = "";

    expect(configuredAiProvider()).toBeNull();
    expect(getAiRuntimeConfig()).toEqual({
      provider: null,
      aiEnabled: false,
      reviewEngineId: "deterministic:no-ai",
      reviewEngineLabel: "Deterministic evidence review (no AI provider required)"
    });
  });

  it("ignores invalid AI_PROVIDER values instead of breaking review generation", () => {
    process.env.AI_PROVIDER = "unknown-provider";

    expect(configuredAiProvider()).toBeNull();
    expect(getAiRuntimeConfig().aiEnabled).toBe(false);
    expect(getAiRuntimeConfig().reviewEngineId).toBe("deterministic:no-ai");
  });

  it("uses the configured provider only when it is supported", () => {
    process.env.AI_PROVIDER = "openai";

    expect(getAiRuntimeConfig()).toEqual({
      provider: "openai",
      aiEnabled: true,
      reviewEngineId: "provider:openai",
      reviewEngineLabel: "openai structured AI review"
    });
  });
});
