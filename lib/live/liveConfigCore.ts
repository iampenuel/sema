export type LiveEnvironment = Record<string, string | undefined>;

export const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const DEFAULT_LIVE_VOICE = "Kore";

function enabled(value: string | undefined, fallback = false) {
  return value === undefined ? fallback : value === "true";
}

export function resolveLiveConfig(env: LiveEnvironment, nodeEnv = env.NODE_ENV ?? "development") {
  const requestedMinutes = Number(env.SEMA_LIVE_MAX_SESSION_MINUTES ?? 10);
  const maxMinutes = Math.min(10, Math.max(1, Number.isFinite(requestedMinutes) ? requestedMinutes : 10));
  const liveEnabled = enabled(env.SEMA_LIVE_ENABLED);
  const publicDemoEnabled = enabled(env.SEMA_LIVE_PUBLIC_DEMO_ENABLED);
  const uiEnabled = enabled(env.NEXT_PUBLIC_SEMA_LIVE_UI_ENABLED);
  const production = nodeEnv === "production";

  return {
    liveEnabled,
    uiEnabled,
    provider: "gemini_live" as const,
    model: env.SEMA_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL,
    voiceName: env.SEMA_LIVE_VOICE_NAME?.trim() || DEFAULT_LIVE_VOICE,
    thinkingLevel: env.SEMA_LIVE_THINKING_LEVEL?.trim().toLowerCase() || "low",
    maxSessionMinutes: maxMinutes,
    publicDemoEnabled,
    hasApiKey: Boolean(env.GEMINI_API_KEY?.trim()),
    tokenMintingAllowed: liveEnabled && Boolean(env.GEMINI_API_KEY?.trim()) && (!production || publicDemoEnabled),
    production
  };
}
