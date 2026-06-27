export const aiServiceErrorCodes = [
  "AUTHENTICATION_REQUIRED",
  "AI_DISABLED",
  "CONSENT_REQUIRED",
  "PROVIDER_NOT_ALLOWED",
  "TASK_NOT_ALLOWED",
  "EXTERNAL_TRANSMISSION_BLOCKED",
  "MULTIMODAL_TRANSMISSION_BLOCKED",
  "ORGANIZATION_ACCESS_DENIED",
  "PROJECT_ACCESS_DENIED",
  "SETTINGS_NOT_FOUND",
  "ADMIN_REQUIRED",
  "MODEL_NOT_CONFIGURED",
  "PERSISTENCE_ERROR",
  "OUTPUT_VALIDATION_FAILED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_FAILED",
  "TEST_ENDPOINT_DISABLED",
  "INVALID_TEST_PAYLOAD"
] as const;

export type AiServiceErrorCode = (typeof aiServiceErrorCodes)[number];

export type AiExecutionError = {
  code: AiServiceErrorCode;
  message: string;
  retryable: boolean;
  runId?: string;
};

export class AiServiceError extends Error {
  constructor(
    public readonly code: AiServiceErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly runId?: string
  ) {
    super(message);
    this.name = "AiServiceError";
  }

  toSafeError(): AiExecutionError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.runId ? { runId: this.runId } : {})
    };
  }
}
