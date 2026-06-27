/**
 * Anthropic Claude provider adapter.
 *
 * Server-only. API key is read from ANTHROPIC_API_KEY environment variable.
 * Never expose the key to the browser or store it in Supabase tables.
 *
 * The `transport` parameter allows tests to inject a mock fetch function so
 * that no external network calls are made during testing.
 *
 * Live external calls have NOT been verified with real credentials —
 * API keys are empty in the current environment. The adapter is tested
 * with mocked transport only.
 */
import { z } from "zod";
import {
  AiProviderError,
  normalizeProviderError,
  type AiProviderClient,
  type AiProviderRequest,
  type AiProviderTransportResponse
} from "@/lib/ai/provider-interface";

/** Minimal types for the Anthropic Messages API. */
type AnthropicContentBlock = { type: "text"; text: string };

type AnthropicResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  usage: { input_tokens: number; output_tokens: number };
};

type AnthropicErrorResponse = {
  type: "error";
  error: { type: string; message: string };
};

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION  = "2023-06-01";

/** Minimal estimated cost for Anthropic models (USD per 1M tokens). */
const MODEL_COST_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001":  { input: 0.80,  output: 4.00  },
  "claude-sonnet-4-6":          { input: 3.00,  output: 15.00 },
  "claude-opus-4-8":            { input: 15.00, output: 75.00 },
  // Fallback for unknown models.
  default:                      { input: 3.00,  output: 15.00 }
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COST_PER_1M[model] ?? MODEL_COST_PER_1M["default"]!;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

export type AnthropicTransport = (
  url: string,
  init: RequestInit
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function buildMessages(
  request: AiProviderRequest<unknown>
): Array<{ role: "user"; content: string }> {
  // Combine all text input parts. Media parts are stringified as references.
  const parts = request.input.map((part) => {
    if (part.type === "text") return part.text;
    return `[${part.type.toUpperCase()} document:${part.sourceDocumentId} page:${part.pageNumber ?? "?"}]`;
  });
  return [{ role: "user", content: parts.join("\n\n") }];
}

export class AnthropicProvider implements AiProviderClient {
  readonly provider = "anthropic" as const;

  constructor(
    private readonly apiKey: string,
    private readonly transport: AnthropicTransport = async (url, init) => {
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
    }
  ) {}

  async execute<T>(request: AiProviderRequest<T>): Promise<AiProviderTransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    const maxOutputTokens = 4096;
    try {
      const start = Date.now();

      const body = JSON.stringify({
        model: request.model,
        max_tokens: maxOutputTokens,
        system: `${request.systemPrompt}\n\nIMPORTANT: Respond with valid JSON only. No markdown code fences. No preamble.`,
        messages: buildMessages(request)
      });

      const response = await this.transport(`${ANTHROPIC_API_BASE}/messages`, {
        method: "POST",
        headers: {
          "Content-Type":    "application/json",
          "x-api-key":       this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body,
        signal: controller.signal
      }).finally(() => clearTimeout(timer));

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as Partial<AnthropicErrorResponse>;
        const message = errBody?.error?.message ?? `HTTP ${response.status}`;
        throw new AiProviderError(
          "anthropic",
          response.status === 429 ? "rate_limited" :
          response.status === 401 ? "authentication_error" :
          response.status === 403 ? "permission_denied" :
          response.status >= 500  ? "provider_unavailable" :
          "invalid_request",
          message,
          response.status === 429 || response.status >= 500,
          response.status
        );
      }

      const data = (await response.json()) as AnthropicResponse;
      const rawOutput = data.content.find((b) => b.type === "text")?.text ?? "";
      const inputTokens = data.usage.input_tokens;
      const outputTokens = data.usage.output_tokens;

      return {
        rawOutput,
        usage: {
          inputTokens,
          outputTokens,
          estimatedCost: estimateCost(request.model, inputTokens, outputTokens),
          latencyMs,
          providerRunId: data.id
        }
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AiProviderError("anthropic", "timeout", `Request timed out after ${request.timeoutMs}ms.`, true);
      }
      throw normalizeProviderError("anthropic", error);
    }
  }

  async repair<T>(
    request: AiProviderRequest<T>,
    rawOutput: string,
    validationError: string
  ): Promise<AiProviderTransportResponse> {
    const repairRequest: AiProviderRequest<T> = {
      ...request,
      input: [
        ...request.input,
        {
          type: "text",
          text: [
            "Your previous response was invalid. Validation error:",
            validationError,
            "Original response:",
            rawOutput,
            "Return ONLY valid JSON matching the required schema. No explanation, no code fences."
          ].join("\n")
        }
      ]
    };
    return this.execute(repairRequest);
  }
}

/** Resolve the Anthropic API key from environment variables. */
export function resolveAnthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

/** Schema for validating the raw Anthropic API response shape. */
export const anthropicResponseSchema = z.object({
  id:      z.string(),
  type:    z.literal("message"),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage:   z.object({ input_tokens: z.number(), output_tokens: z.number() })
});
