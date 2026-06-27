import type { z } from "zod";
import type { AiProvider } from "./provider";
import type { AiTaskType } from "./tasks";

export type AiTextInput = {
  type: "text";
  text: string;
};

export type AiMediaInput = {
  type: "image" | "document";
  mimeType: string;
  data: string;
  sourceDocumentId: string;
  pageNumber?: number;
};

export type AiInputPart = AiTextInput | AiMediaInput;

export type AiProviderRequest<T> = {
  taskType: AiTaskType;
  model: string;
  systemPrompt: string;
  input: AiInputPart[];
  outputSchemaName: string;
  outputSchema: z.ZodType<T>;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  runId: string;
};

export type AiUsageMetadata = {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  latencyMs: number;
  providerRunId: string | null;
};

export type AiProviderTransportResponse = {
  rawOutput: string;
  usage: AiUsageMetadata;
};

export type AiProviderResponse<T> = {
  data: T;
  usage: AiUsageMetadata;
  validationStatus: "passed" | "repaired";
};

export type AiProviderClient = {
  readonly provider: AiProvider;
  execute<T>(request: AiProviderRequest<T>): Promise<AiProviderTransportResponse>;
  repair?<T>(
    request: AiProviderRequest<T>,
    rawOutput: string,
    validationError: string
  ): Promise<AiProviderTransportResponse>;
};

export const aiProviderErrorCodes = [
  "authentication_error",
  "permission_denied",
  "rate_limited",
  "timeout",
  "invalid_request",
  "invalid_response",
  "content_blocked",
  "provider_unavailable",
  "unknown_provider_error"
] as const;

export type AiProviderErrorCode = (typeof aiProviderErrorCodes)[number];

export class AiProviderError extends Error {
  constructor(
    public readonly provider: AiProvider,
    public readonly code: AiProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode: number | null = null
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export function normalizeProviderError(provider: AiProvider, error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  const candidate = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const message = error instanceof Error ? error.message : "The AI provider returned an unknown error.";

  if (status === 401 || code.includes("auth")) return new AiProviderError(provider, "authentication_error", message, false, status);
  if (status === 403) return new AiProviderError(provider, "permission_denied", message, false, status);
  if (status === 429 || code.includes("rate")) return new AiProviderError(provider, "rate_limited", message, true, status);
  if (code.includes("timeout") || error instanceof DOMException && error.name === "AbortError") {
    return new AiProviderError(provider, "timeout", message, true, status);
  }
  if (status !== null && status >= 500) return new AiProviderError(provider, "provider_unavailable", message, true, status);
  if (status === 400 || status === 422) return new AiProviderError(provider, "invalid_request", message, false, status);
  return new AiProviderError(provider, "unknown_provider_error", message, false, status);
}
