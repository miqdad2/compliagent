import { z } from "zod";

export const aiProviders = ["openai", "anthropic", "gemini", "mistral", "openrouter"] as const;
export const aiProviderSchema = z.enum(aiProviders);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export type AiJsonRequest = {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
};

// Retained for the current deterministic review route. New provider adapters must
// implement AiProviderClient from provider-interface.ts instead of extending this legacy shape.

export type AiJsonClient = {
  provider: AiProvider;
  generateJson<T>(request: AiJsonRequest, schema: z.ZodType<T>): Promise<T>;
};

export type AiRuntimeConfig = {
  provider: AiProvider | null;
  aiEnabled: boolean;
  reviewEngineId: string;
  reviewEngineLabel: string;
};

export function configuredAiProvider(): AiProvider | null {
  const provider = process.env.AI_PROVIDER;
  const parsed = aiProviderSchema.safeParse(provider);
  return parsed.success ? parsed.data : null;
}

export function getAiRuntimeConfig(): AiRuntimeConfig {
  const provider = configuredAiProvider();

  if (provider) {
    return {
      provider,
      aiEnabled: true,
      reviewEngineId: `provider:${provider}`,
      reviewEngineLabel: `${provider} structured AI review`
    };
  }

  return {
    provider: null,
    aiEnabled: false,
    reviewEngineId: "deterministic:no-ai",
    reviewEngineLabel: "Deterministic evidence review (no AI provider required)"
  };
}
