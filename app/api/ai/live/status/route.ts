import { NextResponse } from "next/server";
import { getLiveConfig } from "@/lib/live/liveConfig";

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const config = getLiveConfig();
  const available = config.liveEnabled && config.uiEnabled && config.tokenMintingAllowed;
  return NextResponse.json({
    uiEnabled: config.uiEnabled,
    available,
    provider: config.provider,
    model: config.model,
    voiceName: config.voiceName,
    thinkingLevel: config.thinkingLevel,
    maxSessionMinutes: config.maxSessionMinutes,
    publicDemoTokenEnabled: config.publicDemoEnabled,
    reason: available ? undefined : !config.liveEnabled ? "Live voice is not enabled." : !config.uiEnabled ? "Live voice controls are hidden." : !config.hasApiKey ? "Live voice is not configured." : config.production ? "Public Live tokens are disabled in production." : "Live voice is not available in this environment."
  }, { headers: NO_STORE_HEADERS });
}
