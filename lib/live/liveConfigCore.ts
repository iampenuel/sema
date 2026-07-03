export type LiveEnvironment = Record<string, string | undefined>;
export type SemaDeploymentEnvironment = "local" | "preview" | "production";

export const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const DEFAULT_LIVE_VOICE = "Kore";
export const DEFAULT_LIVE_THINKING_LEVEL = "medium";
export const LIVE_CONTEXT_WINDOW_COMPRESSION = { slidingWindow: {} } as const;

export type SemaLiveThinkingLevel = "minimal" | "low" | "medium" | "high";
const LIVE_THINKING_LEVELS = new Set<SemaLiveThinkingLevel>(["minimal", "low", "medium", "high"]);

export function liveConnectionRolloverDelayMs(maxSessionMinutes: number) {
  return Math.max(30_000, maxSessionMinutes * 60_000 - 60_000);
}

function enabled(value: string | undefined, fallback = false) {
  return value === undefined ? fallback : value === "true";
}

export function resolveLiveThinkingLevel(value: string | undefined): SemaLiveThinkingLevel {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_LIVE_THINKING_LEVEL;
  return LIVE_THINKING_LEVELS.has(normalized as SemaLiveThinkingLevel) ? normalized as SemaLiveThinkingLevel : DEFAULT_LIVE_THINKING_LEVEL;
}

function resolveDeploymentEnvironment(env: LiveEnvironment, nodeEnv: string): SemaDeploymentEnvironment {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  if (env.VERCEL_ENV === "development") return "local";
  return nodeEnv === "production" ? "production" : "local";
}

export function resolveLiveConfig(env: LiveEnvironment, nodeEnv = env.NODE_ENV ?? "development") {
  const requestedMinutes = Number(env.SEMA_LIVE_MAX_SESSION_MINUTES ?? 10);
  const maxMinutes = Math.min(10, Math.max(1, Number.isFinite(requestedMinutes) ? requestedMinutes : 10));
  const liveEnabled = enabled(env.SEMA_LIVE_ENABLED);
  const publicDemoEnabled = enabled(env.SEMA_LIVE_PUBLIC_DEMO_ENABLED);
  const uiEnabled = enabled(env.NEXT_PUBLIC_SEMA_LIVE_UI_ENABLED);
  const deploymentEnvironment = resolveDeploymentEnvironment(env, nodeEnv);
  const production = deploymentEnvironment === "production";

  return {
    liveEnabled,
    uiEnabled,
    provider: "gemini_live" as const,
    model: env.SEMA_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL,
    voiceName: env.SEMA_LIVE_VOICE_NAME?.trim() || DEFAULT_LIVE_VOICE,
    thinkingLevel: resolveLiveThinkingLevel(env.SEMA_LIVE_THINKING_LEVEL),
    maxSessionMinutes: maxMinutes,
    publicDemoEnabled,
    hasApiKey: Boolean(env.GEMINI_API_KEY?.trim()),
    tokenMintingAllowed: liveEnabled && Boolean(env.GEMINI_API_KEY?.trim()) && (!production || publicDemoEnabled),
    production,
    deploymentEnvironment
  };
}
