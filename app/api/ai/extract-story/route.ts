import { NextResponse } from "next/server";
import { ExtractStoryRequestSchema } from "@/lib/ai/aiSchemas";
import { SAFE_AI_ERROR_MESSAGE } from "@/lib/ai/errors";
import { logAIDiagnostic } from "@/lib/ai/diagnostics";
import { getConfiguredProvider } from "@/lib/ai/providerFactory";
import { runWithLocalFallback } from "@/lib/ai/serverFallback";
import { validateStoryExtraction } from "@/lib/ai/validators/validateStoryExtraction";
import { detectUnsafeRequest, getSafeRedirect } from "@/lib/safety/safetyRules";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const parsed = ExtractStoryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_failed", message: "Enter a story before asking Sema to organize it." } }, { status: 400, headers: NO_STORE_HEADERS });

  const safetyFlags = detectUnsafeRequest(parsed.data.rawText);
  if (safetyFlags.length) {
    logAIDiagnostic({ route: "extract-story", status: "blocked", safetyValid: false });
    return NextResponse.json({ error: { code: "safety_blocked", message: getSafeRedirect(safetyFlags) }, safetyFlags }, { status: 422, headers: NO_STORE_HEADERS });
  }

  const { config, provider } = getConfiguredProvider();
  const result = await runWithLocalFallback(provider, (selected) => selected.extractStory(parsed.data, { signal: request.signal }), Boolean(config.fallbackReason));
  if (!result.ok || !result.data) {
    logAIDiagnostic({ route: "extract-story", status: result.error?.code === "cancelled" ? "cancelled" : "rejected", metadata: result.metadata });
    return NextResponse.json({ error: { code: result.error?.code ?? "provider_unavailable", message: SAFE_AI_ERROR_MESSAGE }, metadata: result.metadata }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const validated = validateStoryExtraction(parsed.data.rawText, result.data);
  if (!validated.ok) {
    if (provider.id !== "local") {
      const local = await runWithLocalFallback(new (await import("@/lib/ai/providers/localProvider")).LocalAIProvider(), (selected) => selected.extractStory(parsed.data), true);
      if (local.ok && local.data) {
        logAIDiagnostic({ route: "extract-story", status: "fallback", metadata: local.metadata, schemaValid: validated.reason !== "schema", provenanceValid: validated.reason !== "provenance", safetyValid: validated.reason !== "safety" });
        return NextResponse.json({ draft: local.data, metadata: local.metadata, fallbackNotice: SAFE_AI_ERROR_MESSAGE }, { headers: NO_STORE_HEADERS });
      }
    }
    return NextResponse.json({ error: { code: validated.reason === "safety" ? "safety_blocked" : "validation_failed", message: SAFE_AI_ERROR_MESSAGE }, metadata: result.metadata }, { status: 422, headers: NO_STORE_HEADERS });
  }

  logAIDiagnostic({ route: "extract-story", status: result.metadata.fallbackUsed ? "fallback" : "success", metadata: result.metadata, schemaValid: true, provenanceValid: true, safetyValid: true });
  return NextResponse.json({ draft: validated.data, metadata: result.metadata, fallbackNotice: result.metadata.fallbackUsed ? SAFE_AI_ERROR_MESSAGE : undefined }, { headers: NO_STORE_HEADERS });
}
