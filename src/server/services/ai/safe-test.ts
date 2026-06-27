import { z } from "zod";
import { aiProviderSchema } from "@/lib/ai/provider";
import { mockProviderBehaviors } from "./mock-providers";

export const safeMockTaskTypes = [
  "document_classification",
  "document_understanding",
  "condition_comparison",
  "finding_verification"
] as const;

export const safeMockAiTestPayloadSchema = z
  .object({
    projectId: z.string().uuid(),
    provider: aiProviderSchema,
    taskType: z.enum(safeMockTaskTypes),
    scenario: z.enum(mockProviderBehaviors).default("success")
  })
  .strict();

export type SafeMockAiTestPayload = z.infer<typeof safeMockAiTestPayloadSchema>;

export function isMockAiTestEndpointEnabled(nodeEnvironment: string | undefined, explicitProductionFlag: string | undefined) {
  return nodeEnvironment !== "production" || explicitProductionFlag === "true";
}
