import type { AiProvider } from "./provider";
import { taskModelTier, type AiModelTier, type AiTaskType } from "./tasks";

export type AiProviderRouteConfig = {
  enabled: boolean;
  models: Partial<Record<AiModelTier, string>>;
  taskModels?: Partial<Record<AiTaskType, string>>;
};

export type OrganizationAiConfig = {
  enabled: boolean;
  consentGranted: boolean;
  defaultProvider: AiProvider | null;
  providers: Partial<Record<AiProvider, AiProviderRouteConfig>>;
};

export type AiTaskRoute = {
  taskType: AiTaskType;
  provider: AiProvider;
  model: string;
  modelTier: AiModelTier;
};

export class AiRoutingError extends Error {
  constructor(public readonly code: "ai_disabled" | "consent_required" | "provider_unavailable" | "model_unconfigured", message: string) {
    super(message);
    this.name = "AiRoutingError";
  }
}

export function resolveAiTaskRoute(
  taskType: AiTaskType,
  config: OrganizationAiConfig,
  preferredProvider?: AiProvider
): AiTaskRoute {
  if (!config.enabled) throw new AiRoutingError("ai_disabled", "AI processing is disabled for this organization.");
  if (!config.consentGranted) {
    throw new AiRoutingError("consent_required", "Organization consent is required before documents can be sent to an AI provider.");
  }

  const provider = preferredProvider ?? config.defaultProvider;
  const providerConfig = provider ? config.providers[provider] : undefined;
  if (!provider || !providerConfig?.enabled) {
    throw new AiRoutingError("provider_unavailable", "No enabled AI provider is configured for this organization.");
  }

  const modelTier = taskModelTier[taskType];
  const model = providerConfig.taskModels?.[taskType] ?? providerConfig.models[modelTier];
  if (!model) {
    throw new AiRoutingError("model_unconfigured", `No ${modelTier} model is configured for ${taskType}.`);
  }

  return { taskType, provider, model, modelTier };
}
