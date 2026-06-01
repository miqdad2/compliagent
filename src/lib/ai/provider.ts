import { z } from "zod";

export const aiProviderSchema = z.enum(["openai", "anthropic", "gemini", "mistral", "openrouter"]);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export type AiJsonRequest = {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
};

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
