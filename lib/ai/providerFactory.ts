import "server-only";
import { getAIConfig, type SemaAIConfig } from "./config";
import type { AIStatus, SemaAIProvider } from "./aiTypes";
import { GeminiAIProvider } from "./providers/geminiProvider";
import { LocalAIProvider } from "./providers/localProvider";

export function createProvider(config: SemaAIConfig): SemaAIProvider {
  if (config.activeProvider === "gemini" && config.apiKey) return new GeminiAIProvider({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });
  return new LocalAIProvider();
}

export function getConfiguredProvider() {
  const config = getAIConfig();
  return { config, provider: createProvider(config) };
}

export function getAIStatus(config = getAIConfig()): AIStatus {
  return {
    enabled: config.enabled,
    configuredProvider: config.configuredProvider,
    activeProvider: config.activeProvider,
    model: config.model,
    fallbackActive: config.activeProvider !== config.configuredProvider,
    reason: config.fallbackReason
  };
}
