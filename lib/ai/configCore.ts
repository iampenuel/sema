import type { SemaAIProviderId } from "./aiTypes";

export type SemaAIConfig = {
  enabled: boolean;
  configuredProvider: SemaAIProviderId;
  activeProvider: SemaAIProviderId;
  model: string;
  timeoutMs: number;
  apiKey?: string;
  fallbackReason?: string;
};

function providerId(value: string | undefined): SemaAIProviderId {
  return value === "gemini" || value === "gemma4" || value === "local" ? value : "local";
}

export function resolveAIConfig(env: Record<string, string | undefined>): SemaAIConfig {
  const enabled = env.SEMA_AI_ENABLED !== "false";
  const configuredProvider = providerId(env.SEMA_AI_PROVIDER ?? "gemini");
  const model = env.SEMA_AI_MODEL || "gemini-3.5-flash";
  const timeoutValue = Number(env.SEMA_AI_TIMEOUT_MS || 15000);
  const timeoutMs = Number.isFinite(timeoutValue) ? Math.min(Math.max(timeoutValue, 1000), 60000) : 15000;
  if (!enabled) return { enabled, configuredProvider, activeProvider: "local", model: "local-deterministic-v0.1", timeoutMs, fallbackReason: "AI is disabled." };
  if (configuredProvider === "gemini" && !env.GEMINI_API_KEY) return { enabled, configuredProvider, activeProvider: "local", model: "local-deterministic-v0.1", timeoutMs, fallbackReason: "Gemini is not configured." };
  if (configuredProvider === "gemma4") return { enabled, configuredProvider, activeProvider: "local", model: "local-deterministic-v0.1", timeoutMs, fallbackReason: "Gemma 4 is not configured in this phase." };
  if (configuredProvider === "gemini") return { enabled, configuredProvider, activeProvider: "gemini", model, timeoutMs, apiKey: env.GEMINI_API_KEY };
  return { enabled, configuredProvider, activeProvider: "local", model: "local-deterministic-v0.1", timeoutMs };
}
