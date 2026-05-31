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

export function configuredAiProvider(): AiProvider | null {
  const provider = process.env.AI_PROVIDER;
  const parsed = aiProviderSchema.safeParse(provider);
  return parsed.success ? parsed.data : null;
}
