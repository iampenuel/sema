import type { LivePublicStatus, LiveTokenResponse } from "./liveTypes";

type ThrottleEntry = { count: number; resetAt: number; nonces: Map<string, number> };

export class LiveTokenRateLimiter {
  private entries = new Map<string, ThrottleEntry>();
  constructor(private readonly limit = 3, private readonly windowMs = 60_000) {}

  check(key: string, nonce: string, now = Date.now()) {
    const existing = this.entries.get(key);
    const entry = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + this.windowMs, nonces: new Map<string, number>() } : existing;
    for (const [savedNonce, expires] of entry.nonces) if (expires <= now) entry.nonces.delete(savedNonce);
    if (entry.nonces.has(nonce)) return { allowed: false, reason: "nonce_reused" as const };
    if (entry.count >= this.limit) return { allowed: false, reason: "rate_limited" as const };
    entry.count += 1;
    entry.nonces.set(nonce, entry.resetAt);
    this.entries.set(key, entry);
    return { allowed: true as const, resetAt: entry.resetAt };
  }
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function safeTokenResponse(token: string, expiresAt: string, status: LivePublicStatus): LiveTokenResponse {
  return { token, expiresAt, model: status.model, voiceName: status.voiceName, thinkingLevel: status.thinkingLevel };
}

export function buildLiveTokenTimes(now: number, maxSessionMinutes: number) {
  return {
    expiresAt: new Date(now + Math.min(10, Math.max(1, maxSessionMinutes)) * 60_000),
    newSessionExpiresAt: new Date(now + 60_000)
  };
}
