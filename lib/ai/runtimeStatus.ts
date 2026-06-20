import "server-only";
import { getAIConfig } from "./config";
import { getAIStatus } from "./providerFactory";
import { preflightGeminiModel, type ModelPreflightResult } from "./modelPreflight";
import type { AIStatus } from "./aiTypes";

let cache: { model: string; checkedAt: number; result: ModelPreflightResult } | undefined;

export async function getRuntimeAIStatus(): Promise<AIStatus> {
  const config = getAIConfig();
  const configured = getAIStatus(config);
  if (config.activeProvider !== "gemini" || !config.apiKey) return configured;
  const now = Date.now();
  if (!cache || cache.model !== config.model || now - cache.checkedAt > (cache.result.ok ? 300_000 : 60_000)) {
    cache = { model: config.model, checkedAt: now, result: await preflightGeminiModel({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs }) };
  }
  if (cache.result.ok) return configured;
  return { enabled: config.enabled, configuredProvider: "gemini", activeProvider: "local", model: "local-deterministic-v0.1", fallbackActive: true, reason: "AI enhancement is unavailable; local mode is active." };
}
