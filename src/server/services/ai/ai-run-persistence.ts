import { createHash } from "node:crypto";
import type { AiProviderError } from "@/lib/ai/provider-interface";
import type { AiValidationStatus, AiVerificationStatus } from "@/lib/ai/schemas";
import type { AiProvider } from "@/lib/ai/provider";
import type { AiTaskType } from "@/lib/ai/tasks";
import type { AiUsageMetadata } from "@/lib/ai/provider-interface";
import { AiServiceError, type AiExecutionError } from "./errors";
import type { AiPersistenceGateway, AiRunRow } from "./gateway";

export type SafeAiInputReference = {
  organizationId: string;
  projectId: string;
  reviewId: string | null;
  documentId: string | null;
  taskType: AiTaskType;
  promptVersion: string;
  predefinedPayloadId: string;
};

export function hashAiInputReference(input: SafeAiInputReference): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.organizationId,
        input.projectId,
        input.reviewId,
        input.documentId,
        input.taskType,
        input.promptVersion,
        input.predefinedPayloadId
      ])
    )
    .digest("hex");
}

export class AiRunPersistenceService {
  constructor(
    private readonly gateway: AiPersistenceGateway,
    private readonly now: () => Date = () => new Date()
  ) {}

  create(input: {
    organizationId: string;
    projectId: string;
    reviewId: string | null;
    documentId: string | null;
    taskType: AiTaskType;
    provider: AiProvider;
    model: string;
    promptVersion: string;
    inputHash: string;
    createdBy: string;
  }): Promise<AiRunRow> {
    return this.gateway.createAiRun({
      organization_id: input.organizationId,
      project_id: input.projectId,
      review_id: input.reviewId,
      document_id: input.documentId,
      task_type: input.taskType,
      provider: input.provider,
      model: input.model,
      prompt_version: input.promptVersion,
      input_hash: input.inputHash,
      status: "queued",
      validation_status: "pending",
      verification_status: "pending",
      created_by: input.createdBy
    });
  }

  markRunning(run: AiRunRow): Promise<AiRunRow> {
    return this.gateway.updateAiRun(run.organization_id, run.id, {
      status: "running",
      started_at: this.now().toISOString(),
      error_code: null,
      error_message: null
    });
  }

  markCompleted(
    run: AiRunRow,
    input: {
      usage: AiUsageMetadata;
      validationStatus: Extract<AiValidationStatus, "passed" | "repaired">;
      verificationStatus: AiVerificationStatus;
    }
  ): Promise<AiRunRow> {
    return this.gateway.updateAiRun(run.organization_id, run.id, {
      status: "completed",
      completed_at: this.now().toISOString(),
      latency_ms: input.usage.latencyMs,
      input_tokens: input.usage.inputTokens,
      output_tokens: input.usage.outputTokens,
      estimated_cost: input.usage.estimatedCost,
      provider_run_id: input.usage.providerRunId,
      validation_status: input.validationStatus,
      verification_status: input.verificationStatus,
      error_code: null,
      error_message: null
    });
  }

  markFailed(
    run: AiRunRow,
    input: {
      error: AiExecutionError;
      latencyMs: number;
      validationStatus: Extract<AiValidationStatus, "failed" | "pending">;
    }
  ): Promise<AiRunRow> {
    return this.gateway.updateAiRun(run.organization_id, run.id, {
      status: "failed",
      completed_at: this.now().toISOString(),
      latency_ms: input.latencyMs,
      validation_status: input.validationStatus,
      verification_status: "failed",
      error_code: input.error.code,
      error_message: input.error.message
    });
  }
}

export function mapProviderError(error: AiProviderError, runId: string): AiExecutionError {
  if (error.code === "timeout") {
    return {
      code: "PROVIDER_TIMEOUT",
      message: "The mock AI provider timed out.",
      retryable: true,
      runId
    };
  }
  return {
    code: "PROVIDER_FAILED",
    message: "The mock AI provider could not complete the request.",
    retryable: error.retryable,
    runId
  };
}

export function persistenceFailure(): AiServiceError {
  return new AiServiceError("PERSISTENCE_ERROR", "AI run metadata could not be persisted safely.", true);
}
