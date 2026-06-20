import { NextResponse } from "next/server";
import { getLiveConfig } from "@/lib/live/liveConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getLiveConfig();
  const available = config.liveEnabled && config.uiEnabled && config.tokenMintingAllowed;
  return NextResponse.json({
    uiEnabled: config.uiEnabled,
    available,
    provider: config.provider,
    model: config.model,
    voiceName: config.voiceName,
    maxSessionMinutes: config.maxSessionMinutes,
    publicDemoTokenEnabled: config.publicDemoEnabled,
    reason: available ? undefined : !config.liveEnabled ? "Live voice is not enabled." : !config.uiEnabled ? "Live voice controls are hidden." : !config.hasApiKey ? "Live voice is not configured." : "Public Live tokens are disabled in production."
  });
}
