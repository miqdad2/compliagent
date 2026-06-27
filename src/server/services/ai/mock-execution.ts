import { z } from "zod";
import { AI_AUDIT_ACTIONS } from "@/lib/ai/audit";
import { normalizeProviderError, AiProviderError, type AiProviderRequest } from "@/lib/ai/provider-interface";
import type { AiProvider } from "@/lib/ai/provider";
import { resolveAiTaskRoute, AiRoutingError } from "@/lib/ai/router";
import type { AiTaskType } from "@/lib/ai/tasks";
import { parseAndValidateAiJson } from "@/lib/ai/validation";
import type { AuthProfile } from "@/lib/permissions/server";
import { AiRunPersistenceService, hashAiInputReference, mapProviderError } from "./ai-run-persistence";
import { enforceAiConsent, toOrganizationAiConfig } from "./consent-guard";
import { AiServiceError, type AiExecutionError } from "./errors";
import type { AiPersistenceGateway } from "./gateway";
import {
  MockAiProviderRegistry,
  mockAiOutputSchema,
  type MockAiOutput,
  type MockProviderBehavior
} from "./mock-providers";
import { OrganizationAiSettingsService } from "./organization-settings";

export type MockAiExecutionInput = {
  actor: AuthProfile | null;
  organizationId: string;
  projectId: string;
  provider: AiProvider;
  taskType: AiTaskType;
  promptVersion: string;
  predefinedPayloadId: string;
  behavior: MockProviderBehavior;
  repairInvalidOutput: boolean;
  externalTransmissionRequested: boolean;
  multimodalTransmissionRequested: boolean;
};

export type MockAiExecutionResult =
  | {
      ok: true;
      runId: string;
      taskType: AiTaskType;
      status: "completed";
      validationStatus: "passed" | "repaired";
      provider: AiProvider;
      mockProvider: string;
      model: string;
      output: MockAiOutput;
    }
  | {
      ok: false;
      error: AiExecutionError;
    };

export class MockAiExecutionService {
  private readonly settingsService: OrganizationAiSettingsService;
  private readonly runService: AiRunPersistenceService;

  constructor(
    private readonly gateway: AiPersistenceGateway,
    private readonly providers = new MockAiProviderRegistry(),
    private readonly now: () => Date = () => new Date()
  ) {
    this.settingsService = new OrganizationAiSettingsService(gateway, now);
    this.runService = new AiRunPersistenceService(gateway, now);
  }

  async execute(input: MockAiExecutionInput): Promise<MockAiExecutionResult> {
    try {
      return await this.executeControlled(input);
    } catch (error) {
      if (error instanceof AiServiceError) return { ok: false, error: error.toSafeError() };
      return {
        ok: false,
        error: {
          code: "PERSISTENCE_ERROR",
          message: "The mock AI run could not be completed safely.",
          retryable: true
        }
      };
    }
  }

  private async executeControlled(input: MockAiExecutionInput): Promise<MockAiExecutionResult> {
    if (!input.actor) {
      return {
        ok: false,
        error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required to run an AI task.", retryable: false }
      };
    }
    if (input.actor.organization_id !== input.organizationId) {
      return {
        ok: false,
        error: { code: "ORGANIZATION_ACCESS_DENIED", message: "You do not have access to the requested organization.", retryable: false }
      };
    }
    const [project, settings] = await Promise.all([
      this.gateway.getProjectScope(input.projectId),
      this.settingsService.get(input.actor, input.organizationId)
    ]);
    const guard = enforceAiConsent({
      actor: input.actor,
      organizationId: input.organizationId,
      projectId: input.projectId,
      project,
      settings,
      provider: input.provider,
      taskType: input.taskType,
      externalTransmissionRequested: input.externalTransmissionRequested,
      multimodalTransmissionRequested: input.multimodalTransmissionRequested
    });

    if (!guard.allowed) {
      if (input.actor?.organization_id === input.organizationId && guard.error.code === "CONSENT_REQUIRED") {
        await this.gateway.writeAudit({
          organizationId: input.organizationId,
          projectId: project?.organizationId === input.organizationId ? input.projectId : null,
          userId: input.actor.id,
          action: AI_AUDIT_ACTIONS.RUN_BLOCKED_BY_CONSENT,
          entityType: "ai_run",
          entityId: null,
          metadata: { denialCode: guard.error.code, taskType: input.taskType, provider: input.provider }
        });
      }
      return { ok: false, error: guard.error };
    }

    let route;
    try {
      route = resolveAiTaskRoute(input.taskType, toOrganizationAiConfig(guard.settings), input.provider);
    } catch (error) {
      const message = error instanceof AiRoutingError ? error.message : "No mock model route is configured for this task.";
      return {
        ok: false,
        error: { code: "MODEL_NOT_CONFIGURED", message, retryable: false }
      };
    }

    const inputHash = hashAiInputReference({
      organizationId: input.organizationId,
      projectId: input.projectId,
      reviewId: null,
      documentId: null,
      taskType: input.taskType,
      promptVersion: input.promptVersion,
      predefinedPayloadId: input.predefinedPayloadId
    });
    let run = await this.runService.create({
      organizationId: input.organizationId,
      projectId: input.projectId,
      reviewId: null,
      documentId: null,
      taskType: input.taskType,
      provider: route.provider,
      model: route.model,
      promptVersion: input.promptVersion,
      inputHash,
      createdBy: guard.actor.id
    });

    await this.gateway.writeAudit({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: guard.actor.id,
      action: AI_AUDIT_ACTIONS.RUN_REQUESTED,
      entityType: "ai_run",
      entityId: run.id,
      metadata: { taskType: input.taskType, provider: route.provider, model: route.model, executionMode: "mock" }
    });

    run = await this.runService.markRunning(run);
    await this.gateway.writeAudit({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: guard.actor.id,
      action: AI_AUDIT_ACTIONS.RUN_STARTED,
      entityType: "ai_run",
      entityId: run.id,
      metadata: { taskType: input.taskType, executionMode: "mock" }
    });

    const startedAt = this.now().getTime();
    const provider = this.providers.get(route.modelTier, route.provider, input.behavior);
    const request: AiProviderRequest<MockAiOutput> = {
      taskType: input.taskType,
      model: route.model,
      systemPrompt: "Return the predefined CompliAgent mock infrastructure test result only.",
      input: [{ type: "text", text: "COMPLIAGENT_SAFE_MOCK_PAYLOAD_V1" }],
      outputSchemaName: "mockAiOutput",
      outputSchema: mockAiOutputSchema,
      temperature: 0,
      timeoutMs: 1_000,
      maxRetries: 0,
      runId: run.id
    };

    try {
      const response = await provider.execute(request);
      const validated = await parseAndValidateAiJson(response.rawOutput, mockAiOutputSchema, async (raw, error) => {
        await this.gateway.writeAudit({
          organizationId: input.organizationId,
          projectId: input.projectId,
          userId: guard.actor.id,
          action: AI_AUDIT_ACTIONS.OUTPUT_VALIDATION_FAILED,
          entityType: "ai_run",
          entityId: run.id,
          metadata: { taskType: input.taskType, executionMode: "mock" }
        });
        if (!input.repairInvalidOutput || !provider.repair) return raw;
        await this.gateway.writeAudit({
          organizationId: input.organizationId,
          projectId: input.projectId,
          userId: guard.actor.id,
          action: AI_AUDIT_ACTIONS.MOCK_REPAIR_ATTEMPTED,
          entityType: "ai_run",
          entityId: run.id,
          metadata: { taskType: input.taskType, attempt: 1 }
        });
        const repaired = await provider.repair(request, raw, error);
        return repaired.rawOutput;
      });
      const completed = await this.runService.markCompleted(run, {
        usage: response.usage,
        validationStatus: validated.repaired ? "repaired" : "passed",
        verificationStatus: "not_required"
      });
      await this.gateway.writeAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: guard.actor.id,
        action: AI_AUDIT_ACTIONS.RUN_COMPLETED,
        entityType: "ai_run",
        entityId: run.id,
        metadata: { taskType: input.taskType, validationStatus: completed.validation_status, executionMode: "mock" }
      });
      return {
        ok: true,
        runId: completed.id,
        taskType: completed.task_type,
        status: "completed",
        validationStatus: validated.repaired ? "repaired" : "passed",
        provider: route.provider,
        mockProvider: `mock-${route.modelTier}`,
        model: route.model,
        output: validated.data
      };
    } catch (error) {
      const isValidationFailure = error instanceof SyntaxError || error instanceof z.ZodError;
      const safeError: AiExecutionError = isValidationFailure
        ? {
            code: "OUTPUT_VALIDATION_FAILED",
            message: "The mock AI output failed structured validation.",
            retryable: false,
            runId: run.id
          }
        : mapProviderError(
            error instanceof AiProviderError ? error : normalizeProviderError(route.provider, error),
            run.id
          );
      if (isValidationFailure) {
        await this.gateway.writeAudit({
          organizationId: input.organizationId,
          projectId: input.projectId,
          userId: guard.actor.id,
          action: AI_AUDIT_ACTIONS.OUTPUT_VALIDATION_FAILED,
          entityType: "ai_run",
          entityId: run.id,
          metadata: { taskType: input.taskType, terminal: true }
        });
      }
      await this.runService.markFailed(run, {
        error: safeError,
        latencyMs: Math.max(0, this.now().getTime() - startedAt),
        validationStatus: isValidationFailure ? "failed" : "pending"
      });
      await this.gateway.writeAudit({
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: guard.actor.id,
        action: AI_AUDIT_ACTIONS.RUN_FAILED,
        entityType: "ai_run",
        entityId: run.id,
        metadata: { taskType: input.taskType, errorCode: safeError.code, retryable: safeError.retryable }
      });
      return { ok: false, error: safeError };
    }
  }
}
