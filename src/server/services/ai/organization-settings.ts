import { z } from "zod";
import { AI_AUDIT_ACTIONS } from "@/lib/ai/audit";
import { aiProviders, aiProviderSchema, type AiProvider } from "@/lib/ai/provider";
import { aiModelTiers, aiTaskTypes, type AiModelTier, type AiTaskType } from "@/lib/ai/tasks";
import { canManageOrganization } from "@/lib/permissions/roles";
import type { AuthProfile } from "@/lib/permissions/server";
import type { Json } from "@/types/database";
import { AiServiceError } from "./errors";
import type { AiPersistenceGateway, OrganizationAiSettingsRow } from "./gateway";

const modelNameSchema = z.string().trim().min(1).max(200);
const taskModelsSchema = z
  .object({
    document_classification:       modelNameSchema.optional(),
    document_understanding:        modelNameSchema.optional(),
    requirement_extraction:        modelNameSchema.optional(),
    requirement_refinement:        modelNameSchema.optional(),
    requirement_decomposition:     modelNameSchema.optional(),
    evidence_retrieval:            modelNameSchema.optional(),
    evidence_reranking:            modelNameSchema.optional(),
    condition_comparison:          modelNameSchema.optional(),
    standards_applicability:       modelNameSchema.optional(),
    finding_verification:          modelNameSchema.optional(),
    annotation_comment_generation: modelNameSchema.optional(),
    report_summary:                modelNameSchema.optional(),
    project_chat:                  modelNameSchema.optional()
  })
  .strict()
  .default({});
const providerModelConfigSchema = z
  .object({
    lightweight: modelNameSchema.optional(),
    multimodal: modelNameSchema.optional(),
    reasoning: modelNameSchema.optional(),
    verifier: modelNameSchema.optional(),
    taskModels: taskModelsSchema
  })
  .strict();

const providerRoutesSchema = z
  .object({
    openai: providerModelConfigSchema.optional(),
    anthropic: providerModelConfigSchema.optional(),
    gemini: providerModelConfigSchema.optional(),
    mistral: providerModelConfigSchema.optional(),
    openrouter: providerModelConfigSchema.optional()
  })
  .strict();

export const aiRetentionPreferences = ["no_storage", "provider_zero_retention", "provider_managed"] as const;
export const aiRetentionPreferenceSchema = z.enum(aiRetentionPreferences);

const persistedRoutingSettingsSchema = z
  .object({
    version: z.literal(1),
    allowedTaskTypes: z.array(z.enum(aiTaskTypes)),
    externalDocumentTransmissionAllowed: z.boolean(),
    multimodalTransmissionAllowed: z.boolean(),
    retentionPreference: aiRetentionPreferenceSchema,
    providerRoutes: providerRoutesSchema
  })
  .strict();

export const organizationAiSettingsUpdateSchema = z
  .object({
    organizationId: z.string().uuid(),
    aiEnabled: z.boolean(),
    consentGranted: z.boolean(),
    consentVersion: z.string().trim().min(1).max(100).nullable(),
    defaultProvider: aiProviderSchema.nullable(),
    allowedProviders: z.array(aiProviderSchema),
    allowedTaskTypes: z.array(z.enum(aiTaskTypes)),
    externalDocumentTransmissionAllowed: z.boolean(),
    multimodalTransmissionAllowed: z.boolean(),
    retentionPreference: aiRetentionPreferenceSchema.default("no_storage"),
    providerRoutes: providerRoutesSchema
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.consentGranted && settings.consentVersion === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["consentVersion"], message: "Consent version is required when consent is granted." });
    }
    if (settings.aiEnabled && !settings.consentGranted) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["consentGranted"], message: "AI cannot be enabled without recorded consent." });
    }
    if (settings.aiEnabled && settings.defaultProvider === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultProvider"], message: "Enabled AI settings require a default provider." });
    }
    if (settings.defaultProvider !== null && !settings.allowedProviders.includes(settings.defaultProvider)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["allowedProviders"], message: "The default provider must be allowed." });
    }
    if (settings.multimodalTransmissionAllowed && !settings.externalDocumentTransmissionAllowed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["multimodalTransmissionAllowed"],
        message: "Multimodal transmission cannot be enabled while external document transmission is blocked."
      });
    }
  });

export type OrganizationAiSettingsUpdate = z.infer<typeof organizationAiSettingsUpdateSchema>;
export type AiRetentionPreference = z.infer<typeof aiRetentionPreferenceSchema>;

export type OrganizationAiSettings = {
  organizationId: string;
  aiEnabled: boolean;
  consentGranted: boolean;
  consentVersion: string | null;
  consentTimestamp: string | null;
  consentRecordedBy: string | null;
  defaultProvider: AiProvider | null;
  allowedProviders: AiProvider[];
  allowedTaskTypes: AiTaskType[];
  externalDocumentTransmissionAllowed: boolean;
  multimodalTransmissionAllowed: boolean;
  retentionPreference: AiRetentionPreference;
  providerRoutes: Partial<
    Record<
      AiProvider,
      Partial<Record<AiModelTier, string>> & { taskModels: Partial<Record<AiTaskType, string>> }
    >
  >;
};

export function disabledOrganizationAiSettings(organizationId: string): OrganizationAiSettings {
  return {
    organizationId,
    aiEnabled: false,
    consentGranted: false,
    consentVersion: null,
    consentTimestamp: null,
    consentRecordedBy: null,
    defaultProvider: null,
    allowedProviders: [],
    allowedTaskTypes: [],
    externalDocumentTransmissionAllowed: false,
    multimodalTransmissionAllowed: false,
    retentionPreference: "no_storage",
    providerRoutes: {}
  };
}

function parseProviderRoutes(
  routes: z.infer<typeof providerRoutesSchema>
): OrganizationAiSettings["providerRoutes"] {
  const parsed: OrganizationAiSettings["providerRoutes"] = {};
  for (const provider of aiProviders) {
    const route = routes[provider];
    if (!route) continue;
    const taskModels: Partial<Record<AiTaskType, string>> = {};
    for (const taskType of aiTaskTypes) {
      const model = route.taskModels[taskType];
      if (model) taskModels[taskType] = model;
    }
    const tierModels: Partial<Record<AiModelTier, string>> = {};
    for (const tier of aiModelTiers) {
      const model = route[tier];
      if (model) tierModels[tier] = model;
    }
    parsed[provider] = { ...tierModels, taskModels };
  }
  return parsed;
}

export function mapOrganizationAiSettings(row: OrganizationAiSettingsRow): OrganizationAiSettings {
  const routing = persistedRoutingSettingsSchema.safeParse(row.model_routes);
  const safeRouting = routing.success
    ? routing.data
    : {
        version: 1 as const,
        allowedTaskTypes: [] as AiTaskType[],
        externalDocumentTransmissionAllowed: false,
        multimodalTransmissionAllowed: false,
        retentionPreference: "no_storage" as const,
        providerRoutes: {}
      };

  return {
    organizationId: row.organization_id,
    aiEnabled: row.ai_enabled && routing.success,
    consentGranted: Boolean(row.consent_granted_at && row.consent_granted_by && row.consent_document_version),
    consentVersion: row.consent_document_version,
    consentTimestamp: row.consent_granted_at,
    consentRecordedBy: row.consent_granted_by,
    defaultProvider: row.default_provider,
    allowedProviders: row.enabled_providers,
    allowedTaskTypes: safeRouting.allowedTaskTypes,
    externalDocumentTransmissionAllowed: safeRouting.externalDocumentTransmissionAllowed,
    multimodalTransmissionAllowed: safeRouting.multimodalTransmissionAllowed,
    retentionPreference: safeRouting.retentionPreference,
    providerRoutes: parseProviderRoutes(safeRouting.providerRoutes)
  };
}

export class OrganizationAiSettingsService {
  constructor(
    private readonly gateway: AiPersistenceGateway,
    private readonly now: () => Date = () => new Date()
  ) {}

  async get(actor: AuthProfile, organizationId: string): Promise<OrganizationAiSettings | null> {
    if (actor.organization_id !== organizationId) {
      throw new AiServiceError("ORGANIZATION_ACCESS_DENIED", "AI settings can only be read within your organization.");
    }
    const row = await this.gateway.getOrganizationAiSettings(organizationId);
    return row ? mapOrganizationAiSettings(row) : null;
  }

  async getEffective(actor: AuthProfile, organizationId: string): Promise<OrganizationAiSettings> {
    return (await this.get(actor, organizationId)) ?? disabledOrganizationAiSettings(organizationId);
  }

  async update(actor: AuthProfile, input: OrganizationAiSettingsUpdate): Promise<OrganizationAiSettings> {
    const settings = organizationAiSettingsUpdateSchema.parse(input);
    if (!canManageOrganization(actor.role)) {
      throw new AiServiceError("ADMIN_REQUIRED", "Administrator permission is required to update AI settings.");
    }
    if (actor.organization_id !== settings.organizationId) {
      throw new AiServiceError("ORGANIZATION_ACCESS_DENIED", "AI settings can only be updated within your organization.");
    }

    const consentTimestamp = settings.consentGranted ? this.now().toISOString() : null;
    const providerRoutes: Record<string, Json> = {};
    for (const provider of aiProviders) {
      const route = settings.providerRoutes[provider];
      if (route) providerRoutes[provider] = route as unknown as Json;
    }
    const modelRoutes: Json = {
      version: 1,
      allowedTaskTypes: settings.allowedTaskTypes,
      externalDocumentTransmissionAllowed: settings.externalDocumentTransmissionAllowed,
      multimodalTransmissionAllowed: settings.multimodalTransmissionAllowed,
      retentionPreference: settings.retentionPreference,
      providerRoutes
    };

    const row = await this.gateway.upsertOrganizationAiSettings({
      organization_id: settings.organizationId,
      ai_enabled: settings.aiEnabled,
      consent_granted_at: consentTimestamp,
      consent_granted_by: settings.consentGranted ? actor.id : null,
      consent_document_version: settings.consentGranted ? settings.consentVersion : null,
      default_provider: settings.defaultProvider,
      enabled_providers: settings.allowedProviders,
      model_routes: modelRoutes
    });

    await this.gateway.writeAudit({
      organizationId: settings.organizationId,
      projectId: null,
      userId: actor.id,
      action: AI_AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "organization_ai_settings",
      entityId: settings.organizationId,
      metadata: {
        aiEnabled: settings.aiEnabled,
        consentGranted: settings.consentGranted,
        consentVersion: settings.consentGranted ? settings.consentVersion : null,
        allowedProviders: settings.allowedProviders,
        allowedTaskTypes: settings.allowedTaskTypes,
        externalDocumentTransmissionAllowed: settings.externalDocumentTransmissionAllowed,
        multimodalTransmissionAllowed: settings.multimodalTransmissionAllowed,
        retentionPreference: settings.retentionPreference
      }
    });

    return mapOrganizationAiSettings(row);
  }
}
