import { NextResponse } from "next/server";
import { PacketAIRequestSchema } from "@/lib/ai/aiSchemas";
import { SAFE_AI_ERROR_MESSAGE } from "@/lib/ai/errors";
import { logAIDiagnostic } from "@/lib/ai/diagnostics";
import { getConfiguredProvider } from "@/lib/ai/providerFactory";
import { LocalAIProvider } from "@/lib/ai/providers/localProvider";
import { runWithLocalFallback } from "@/lib/ai/serverFallback";
import { validatePacketDraft } from "@/lib/ai/validators/validatePacketDraft";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const parsed = PacketAIRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_failed", message: "Only approved session content can be used for this draft." } }, { status: 400, headers: NO_STORE_HEADERS });
  const readiness = parsed.data.approvedSessionContent.packetReadiness;
  if (!readiness?.ready) {
    return NextResponse.json({
      ok: false,
      code: "packet_not_ready",
      missingRequirements: readiness?.unresolvedRequirements ?? [{ key: "readiness", label: "Packet readiness", reason: "Packet readiness was not provided by the client." }]
    }, { status: 409, headers: NO_STORE_HEADERS });
  }

  const { config, provider } = getConfiguredProvider();
  const result = await runWithLocalFallback(provider, (selected) => selected.draftPacketContent(parsed.data, { signal: request.signal }), Boolean(config.fallbackReason));
  const validated = result.data ? validatePacketDraft(result.data, parsed.data.approvedSessionContent) : null;
  if (!result.ok || !validated?.ok) {
    const fallback = await new LocalAIProvider().draftPacketContent(parsed.data);
    const fallbackValidated = fallback.data ? validatePacketDraft(fallback.data, parsed.data.approvedSessionContent) : null;
    if (fallback.ok && fallbackValidated?.ok) {
      const metadata = { ...fallback.metadata, fallbackUsed: true };
      logAIDiagnostic({ route: "draft-packet", status: "fallback", metadata, schemaValid: validated?.reason !== "schema", safetyValid: validated?.reason !== "safety" });
      return NextResponse.json({ draft: fallbackValidated.data, metadata, fallbackNotice: SAFE_AI_ERROR_MESSAGE }, { headers: NO_STORE_HEADERS });
    }
    logAIDiagnostic({ route: "draft-packet", status: result.error?.code === "cancelled" ? "cancelled" : "rejected", metadata: result.metadata, schemaValid: validated?.reason !== "schema", safetyValid: validated?.reason !== "safety" });
    return NextResponse.json({ error: { code: result.error?.code ?? "validation_failed", message: SAFE_AI_ERROR_MESSAGE }, metadata: result.metadata }, { status: 503, headers: NO_STORE_HEADERS });
  }

  logAIDiagnostic({ route: "draft-packet", status: result.metadata.fallbackUsed ? "fallback" : "success", metadata: result.metadata, schemaValid: true, safetyValid: true });
  return NextResponse.json({ draft: validated.data, metadata: result.metadata, fallbackNotice: result.metadata.fallbackUsed ? SAFE_AI_ERROR_MESSAGE : undefined }, { headers: NO_STORE_HEADERS });
}
