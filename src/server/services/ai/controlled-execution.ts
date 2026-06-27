/**
 * Generic controlled AI execution service.
 *
 * Handles the full lifecycle for a single AI task:
 *   consent + routing → run creation → execution → validate/repair → persist → audit
 *
 * Used by the review pipeline services (comparison, verification, reranking, etc.).
 * Does NOT hold any review-domain logic — only provider infrastructure.
 *
 * Live external calls have NOT been verified — API keys are empty in the current
 * environment. The service is tested with mocked transport only.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { AI_AUDIT_ACTIONS } from "@/lib/ai/audit";
import { parseAndValidateAiJson } from "@/lib/ai/validation";
import { resolveAiTaskRoute, AiRoutingError } from "@/lib/ai/router";
import { enforceAiConsent, toOrganizationAiConfig } from "./consent-guard";
import { AiServiceError, type AiExecutionError } from "./errors";
import { AiRunPersistenceService } from "./ai-run-persistence";
import { OrganizationAiSettingsService } from "./organization-settings";
import { resolveProviderClient } from "./provider-registry";
import type { AiPersistenceGateway } from "./gateway";
import type { AiInputPart, AiProviderError } from "@/lib/ai/provider-interface";
import type { AiProvider } from "@/lib/ai/provider";
import type { AiTaskType } from "@/lib/ai/tasks";
import type { AuthProfile } from "@/lib/permissions/server";

export type ControlledExecutionInput<T> = {
  actor:                           AuthProfile;
  organizationId:                  string;
  projectId:                       string;
  reviewId:                        string | null;
  documentId:                      string | null;
  taskType:                        AiTaskType;
  promptVersion:                   string;
  systemPrompt:                    string;
  input:                           AiInputPart[];
  /** SHA-256 hash of the logical input — must not include confidential text. */
  inputHash:                       string;
  outputSchema:                    z.ZodType<T>;
  outputSchemaName:                string;
  temperature?:                    number;
  timeoutMs?:                      number;
  preferredProvider?:              AiProvider;
  externalTransmissionRequested:   boolean;
  multimodalTransmissionRequested: boolean;
};

export type ControlledExecutionResult<T> =
  | { ok: true;  data: T; runId: string; provider: AiProvider; model: string; repaired: boolean }
  | { ok: false; error: AiExecutionError };

/** Hash safe reference fields (never include raw document text). */
export function hashSafeInputRef(fields: {
  organizationId: string;
  projectId:      string;
  reviewId:       string | null;
  entityId:       string | null;
  taskType:       string;
  promptVersion:  string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      fields.organizationId, fields.projectId, fields.reviewId,
      fields.entityId, fields.taskType, fields.promptVersion
    ]))
    .digest("hex");
}

export class ControlledAiExecutionService {
  private readonly settingsService: OrganizationAiSettingsService;
  private readonly runService: AiRunPersistenceService;

  constructor(
    private readonly gateway: AiPersistenceGateway,
    private readonly now: () => Date = () => new Date()
  ) {
    this.settingsService = new OrganizationAiSettingsService(gateway, now);
    this.runService      = new AiRunPersistenceService(gateway, now);
  }

  async execute<T>(input: ControlledExecutionInput<T>): Promise<ControlledExecutionResult<T>> {
    try {
      return await this._execute(input);
    } catch (error) {
      if (error instanceof AiServiceError) return { ok: false, error: error.toSafeError() };
      return { ok: false, error: { code: "PERSISTENCE_ERROR", message: "Unexpected error during AI execution.", retryable: true } };
    }
  }

  private async _execute<T>(input: ControlledExecutionInput<T>): Promise<ControlledExecutionResult<T>> {
    const startMs = this.now().getTime();

    // Load settings and project scope.
    const settings = await this.settingsService.getEffective(input.actor, input.organizationId);
    const project  = await this.gateway.getProjectScope(input.projectId);

    // Consent guard.
    const consentResult = enforceAiConsent({
      actor:                          input.actor,
      organizationId:                 input.organizationId,
      projectId:                      input.projectId,
      project,
      settings,
      provider:                       input.preferredProvider ?? settings.defaultProvider ?? "anthropic",
      taskType:                       input.taskType,
      externalTransmissionRequested:  input.externalTransmissionRequested,
      multimodalTransmissionRequested: input.multimodalTransmissionRequested
    });

    if (!consentResult.allowed) {
      await this.gateway.writeAudit({
        organizationId: input.organizationId,
        projectId:      input.projectId,
        userId:         input.actor.id,
        action:         AI_AUDIT_ACTIONS.RUN_BLOCKED_BY_CONSENT,
        entityType:     "ai_runs",
        entityId:       null,
        metadata:       { taskType: input.taskType, errorCode: consentResult.error.code }
      });
      return { ok: false, error: consentResult.error };
    }

    // Route to provider/model.
    const effectiveProvider = input.preferredProvider ?? consentResult.settings.defaultProvider ?? "anthropic";
    const orgConfig = toOrganizationAiConfig(consentResult.settings);
    let route;
    try {
      route = resolveAiTaskRoute(input.taskType, orgConfig, effectiveProvider);
    } catch (error) {
      const code =
        error instanceof AiRoutingError && error.code === "ai_disabled"    ? "AI_DISABLED" :
        error instanceof AiRoutingError && error.code === "consent_required"? "CONSENT_REQUIRED" :
                                                                               "MODEL_NOT_CONFIGURED";
      return { ok: false, error: { code, message: (error as Error).message, retryable: false } };
    }

    // Resolve provider credentials from environment (never from DB).
    const client = resolveProviderClient(route.provider);
    if (!client) {
      return {
        ok: false,
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: `No credentials found for provider "${route.provider}". Set ${route.provider.toUpperCase()}_API_KEY in server environment variables.`,
          retryable: false
        }
      };
    }

    // Create run record.
    const run = await this.runService.create({
      organizationId: input.organizationId,
      projectId:      input.projectId,
      reviewId:       input.reviewId,
      documentId:     input.documentId,
      taskType:       input.taskType,
      provider:       route.provider,
      model:          route.model,
      promptVersion:  input.promptVersion,
      inputHash:      input.inputHash,
      createdBy:      input.actor.id
    });

    await this.gateway.writeAudit({
      organizationId: input.organizationId, projectId: input.projectId, userId: input.actor.id,
      action: AI_AUDIT_ACTIONS.RUN_REQUESTED, entityType: "ai_runs", entityId: run.id,
      metadata: { taskType: input.taskType, provider: route.provider, model: route.model }
    });

    await this.runService.markRunning(run);

    await this.gateway.writeAudit({
      organizationId: input.organizationId, projectId: input.projectId, userId: input.actor.id,
      action: AI_AUDIT_ACTIONS.RUN_STARTED, entityType: "ai_runs", entityId: run.id,
      metadata: { taskType: input.taskType }
    });

    // Execute.
    const providerRequest = {
      taskType:         input.taskType,
      model:            route.model,
      systemPrompt:     input.systemPrompt,
      input:            input.input,
      outputSchemaName: input.outputSchemaName,
      outputSchema:     input.outputSchema,
      temperature:      input.temperature ?? 0,
      timeoutMs:        input.timeoutMs   ?? 30_000,
      maxRetries:       1,
      runId:            run.id
    };

    let rawOutput: string;
    let usage: { inputTokens: number | null; outputTokens: number | null; estimatedCost: number | null; latencyMs: number; providerRunId: string | null };

    try {
      const transport = await client.execute(providerRequest);
      rawOutput = transport.rawOutput;
      usage     = transport.usage;
    } catch (err) {
      const latencyMs = this.now().getTime() - startMs;
      const provErr = err as Partial<AiProviderError & { retryable: boolean }>;
      const execErr: AiExecutionError = {
        code:      (provErr?.code === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_FAILED") as AiExecutionError["code"],
        message:   err instanceof Error ? err.message : "Provider execution failed.",
        retryable: provErr?.retryable ?? false,
        runId:     run.id
      };
      await this.runService.markFailed(run, { error: execErr, latencyMs, validationStatus: "pending" });
      await this.gateway.writeAudit({
        organizationId: input.organizationId, projectId: input.projectId, userId: input.actor.id,
        action: AI_AUDIT_ACTIONS.RUN_FAILED, entityType: "ai_runs", entityId: run.id,
        metadata: { taskType: input.taskType, errorCode: execErr.code }
      });
      return { ok: false, error: execErr };
    }

    // Validate + one repair attempt.
    let parsed: { data: T; repaired: boolean };
    try {
      parsed = await parseAndValidateAiJson<T>(
        rawOutput,
        input.outputSchema,
        async (failedRaw: string, validationError: string) => {
          await this.gateway.writeAudit({
            organizationId: input.organizationId, projectId: input.projectId, userId: input.actor.id,
            action: AI_AUDIT_ACTIONS.OUTPUT_VALIDATION_FAILED, entityType: "ai_runs", entityId: run.id,
            metadata: { taskType: input.taskType }
          });
          if (!client.repair) throw new Error("Output validation failed and provider does not support repair.");
          const repaired = await client.repair(providerRequest, failedRaw, validationError);
          return repaired.rawOutput;
        }
      );
    } catch (err) {
      const latencyMs = this.now().getTime() - startMs;
      const execErr: AiExecutionError = {
        code: "OUTPUT_VALIDATION_FAILED",
        message: err instanceof Error ? err.message : "Output validation failed after repair attempt.",
        retryable: false,
        runId: run.id
      };
      await this.runService.markFailed(run, { error: execErr, latencyMs, validationStatus: "failed" });
      return { ok: false, error: execErr };
    }

    // Mark completed.
    await this.runService.markCompleted(run, {
      usage,
      validationStatus:    parsed.repaired ? "repaired" : "passed",
      verificationStatus:  "not_required"
    });

    await this.gateway.writeAudit({
      organizationId: input.organizationId, projectId: input.projectId, userId: input.actor.id,
      action: AI_AUDIT_ACTIONS.RUN_COMPLETED, entityType: "ai_runs", entityId: run.id,
      metadata: { taskType: input.taskType, validationStatus: parsed.repaired ? "repaired" : "passed", latencyMs: usage.latencyMs }
    });

    return { ok: true, data: parsed.data, runId: run.id, provider: route.provider, model: route.model, repaired: parsed.repaired };
  }
}
