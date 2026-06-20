import { NextResponse } from "next/server";
import { getLiveConfig } from "@/lib/live/liveConfig";
import { classifyLiveError } from "@/lib/live/liveErrors";
import { mintGeminiLiveToken } from "@/lib/live/ephemeralToken";
import { isSameOriginRequest, LiveTokenRateLimiter, safeTokenResponse } from "@/lib/live/liveTokenPolicy";

export const dynamic = "force-dynamic";
const limiter = new LiveTokenRateLimiter();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Cross-origin Live token requests are not allowed." }, { status: 403 });
  const config = getLiveConfig();
  if (!config.tokenMintingAllowed) return NextResponse.json({ error: "Sema Live is unavailable." }, { status: 503 });
  const body = await request.json().catch(() => null) as { nonce?: unknown } | null;
  if (!body || typeof body.nonce !== "string" || body.nonce.length < 16 || body.nonce.length > 128) return NextResponse.json({ error: "A valid one-time request nonce is required." }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwarded || request.headers.get("x-real-ip") || "local";
  const allowed = limiter.check(key, body.nonce);
  if (!allowed.allowed) return NextResponse.json({ error: allowed.reason === "rate_limited" ? "Live token requests are temporarily limited." : "That token request was already used." }, { status: 429 });
  try {
    const minted = await mintGeminiLiveToken();
    const status = { uiEnabled: config.uiEnabled, available: true, provider: config.provider, model: config.model, voiceName: config.voiceName, maxSessionMinutes: config.maxSessionMinutes, publicDemoTokenEnabled: config.publicDemoEnabled };
    return NextResponse.json(safeTokenResponse(minted.token, minted.expiresAt, status));
  } catch (error) {
    const safe = classifyLiveError(error);
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.code === "rate_limited" ? 429 : safe.code === "timeout" ? 504 : 503 });
  }
}
