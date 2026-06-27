/**
 * Resolves an AiProviderClient from the configured organization settings
 * and server-side environment variables.
 *
 * API keys are NEVER read from the database — only from process.env.
 * Returns null when no credentials are available for the selected provider.
 */
import type { AiProvider } from "@/lib/ai/provider";
import type { AiProviderClient } from "@/lib/ai/provider-interface";
import { AnthropicProvider, resolveAnthropicKey, type AnthropicTransport } from "./anthropic-provider";

/** Override for testing: inject a custom transport for the Anthropic adapter. */
let _testTransport: AnthropicTransport | undefined;
export function _injectTestTransport(transport: AnthropicTransport | undefined): void {
  _testTransport = transport;
}

/**
 * Resolve a provider client for `provider`.
 * Returns null if credentials are missing.
 * The client is server-only — never pass it to browser code.
 */
export function resolveProviderClient(provider: AiProvider): AiProviderClient | null {
  switch (provider) {
    case "anthropic": {
      const key = resolveAnthropicKey();
      if (!key) return null;
      return new AnthropicProvider(key, _testTransport);
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY?.trim() || null;
      if (!key) return null;
      // OpenAI adapter not yet implemented — return null until it is.
      return null;
    }
    case "gemini": {
      const key = process.env.GOOGLE_API_KEY?.trim() || null;
      if (!key) return null;
      return null;
    }
    case "mistral": {
      const key = process.env.MISTRAL_API_KEY?.trim() || null;
      if (!key) return null;
      return null;
    }
    case "openrouter": {
      const key = process.env.OPENROUTER_API_KEY?.trim() || null;
      if (!key) return null;
      return null;
    }
    default:
      return null;
  }
}

/** Returns true only if at least one configured provider has credentials. */
export function anyProviderAvailable(allowedProviders: AiProvider[]): boolean {
  return allowedProviders.some((p) => resolveProviderClient(p) !== null);
}
