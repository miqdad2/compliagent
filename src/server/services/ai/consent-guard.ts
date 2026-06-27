import type { AiProvider } from "@/lib/ai/provider";
import type { OrganizationAiConfig } from "@/lib/ai/router";
import type { AiTaskType } from "@/lib/ai/tasks";
import type { AuthProfile } from "@/lib/permissions/server";
import type { AiExecutionError } from "./errors";
import type { AiProjectScope } from "./gateway";
import type { OrganizationAiSettings } from "./organization-settings";

export type AiConsentGuardInput = {
  actor: AuthProfile | null;
  organizationId: string;
  projectId: string;
  project: AiProjectScope | null;
  settings: OrganizationAiSettings | null;
  provider: AiProvider;
  taskType: AiTaskType;
  externalTransmissionRequested: boolean;
  multimodalTransmissionRequested: boolean;
};

export type AiConsentGuardResult =
  | {
      allowed: true;
      actor: AuthProfile;
      settings: OrganizationAiSettings;
    }
  | {
      allowed: false;
      error: AiExecutionError;
    };

function denied(code: AiExecutionError["code"], message: string): AiConsentGuardResult {
  return { allowed: false, error: { code, message, retryable: false } };
}

export function enforceAiConsent(input: AiConsentGuardInput): AiConsentGuardResult {
  if (!input.actor) return denied("AUTHENTICATION_REQUIRED", "Authentication is required to run an AI task.");
  if (input.actor.organization_id !== input.organizationId) {
    return denied("ORGANIZATION_ACCESS_DENIED", "You do not have access to the requested organization.");
  }
  if (
    !input.project ||
    input.project.id !== input.projectId ||
    input.project.organizationId !== input.organizationId
  ) {
    return denied("PROJECT_ACCESS_DENIED", "The project was not found in your organization.");
  }
  if (!input.settings) return denied("SETTINGS_NOT_FOUND", "AI settings have not been configured for this organization.");
  if (input.settings.organizationId !== input.organizationId) {
    return denied("ORGANIZATION_ACCESS_DENIED", "AI settings do not belong to the requested organization.");
  }
  if (!input.settings.aiEnabled) return denied("AI_DISABLED", "AI processing is disabled for this organization.");
  if (!input.settings.consentGranted) {
    return denied("CONSENT_REQUIRED", "Recorded organization consent is required before an AI task can run.");
  }
  if (!input.settings.allowedProviders.includes(input.provider)) {
    return denied("PROVIDER_NOT_ALLOWED", "The requested AI provider is not allowed for this organization.");
  }
  if (!input.settings.allowedTaskTypes.includes(input.taskType)) {
    return denied("TASK_NOT_ALLOWED", "The requested AI task is not allowed for this organization.");
  }
  if (input.externalTransmissionRequested && !input.settings.externalDocumentTransmissionAllowed) {
    return denied("EXTERNAL_TRANSMISSION_BLOCKED", "External document transmission is blocked for this organization.");
  }
  if (input.multimodalTransmissionRequested && !input.settings.multimodalTransmissionAllowed) {
    return denied("MULTIMODAL_TRANSMISSION_BLOCKED", "Multimodal transmission is blocked for this organization.");
  }

  return { allowed: true, actor: input.actor, settings: input.settings };
}

export function toOrganizationAiConfig(settings: OrganizationAiSettings): OrganizationAiConfig {
  const providers: OrganizationAiConfig["providers"] = {};
  for (const provider of settings.allowedProviders) {
    const route = settings.providerRoutes[provider];
    if (!route) continue;
    const { taskModels, ...models } = route;
    providers[provider] = { enabled: true, models, taskModels };
  }
  return {
    enabled: settings.aiEnabled,
    consentGranted: settings.consentGranted,
    defaultProvider: settings.defaultProvider,
    providers
  };
}
