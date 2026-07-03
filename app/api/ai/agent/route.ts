import { NextResponse } from "next/server";
import { AgentAIProposalSchema, AgentRequestSchema } from "@/lib/ai/aiSchemas";
import { SAFE_AI_ERROR_MESSAGE } from "@/lib/ai/errors";
import { logAIDiagnostic } from "@/lib/ai/diagnostics";
import { routeExactAgentIntent } from "@/lib/ai/localAgentIntent";
import { getConfiguredProvider } from "@/lib/ai/providerFactory";
import { runWithLocalFallback } from "@/lib/ai/serverFallback";
import { validateAgentProposal } from "@/lib/ai/validators/validateAgentProposal";
import { validateModelSafety } from "@/lib/ai/validators/validateModelSafety";
import { detectUnsafeRequest, getSafeRedirect } from "@/lib/safety/safetyRules";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const parsed = AgentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_failed", message: "I could not understand that request." } }, { status: 400, headers: NO_STORE_HEADERS });

  const safetyFlags = detectUnsafeRequest(parsed.data.message);
  if (safetyFlags.length) {
    logAIDiagnostic({ route: "agent", status: "blocked", safetyValid: false });
    return NextResponse.json({ reply: getSafeRedirect(safetyFlags), proposedActions: [], safetyFlags, blocked: true, metadata: { provider: "local", model: "local-safety", fallbackUsed: false } }, { headers: NO_STORE_HEADERS });
  }

  const exact = routeExactAgentIntent(parsed.data.message, parsed.data.context);
  const { config, provider } = getConfiguredProvider();
  const result = exact
    ? { ok: true as const, data: exact, metadata: { provider: "local" as const, model: "local-deterministic-v0.1", fallbackUsed: false } }
    : await runWithLocalFallback(provider, (selected) => selected.proposeAgentResponse(parsed.data, { signal: request.signal }), Boolean(config.fallbackReason));

  const parsedProposal = result.data ? AgentAIProposalSchema.safeParse(result.data) : null;
  if (!result.ok || !parsedProposal?.success) {
    logAIDiagnostic({ route: "agent", status: result.error?.code === "cancelled" ? "cancelled" : "fallback", metadata: result.metadata, schemaValid: parsedProposal?.success ?? false });
    return NextResponse.json({ reply: "I can help open signal folders, list missing details, prepare the packet after permission, or read the safety note.", proposedActions: [], safetyFlags: [], metadata: result.metadata, fallbackNotice: SAFE_AI_ERROR_MESSAGE }, { headers: NO_STORE_HEADERS });
  }

  const safety = validateModelSafety(parsedProposal.data.reply);
  const validated = validateAgentProposal(parsedProposal.data);
  if (!safety.safe || !validated.ok) {
    logAIDiagnostic({ route: "agent", status: "fallback", metadata: { ...result.metadata, fallbackUsed: true }, schemaValid: true, safetyValid: safety.safe });
    return NextResponse.json({ reply: safety.redirect ?? "I can continue with the local session tools.", proposedActions: [], safetyFlags: [], metadata: { ...result.metadata, fallbackUsed: true }, fallbackNotice: SAFE_AI_ERROR_MESSAGE }, { headers: NO_STORE_HEADERS });
  }

  logAIDiagnostic({ route: "agent", status: result.metadata.fallbackUsed ? "fallback" : "success", metadata: result.metadata, schemaValid: true, safetyValid: true });
  return NextResponse.json({ reply: parsedProposal.data.reply, proposedActions: validated.actions, safetyFlags: [], requiresReview: parsedProposal.data.requiresReview, metadata: result.metadata, fallbackNotice: result.metadata.fallbackUsed ? SAFE_AI_ERROR_MESSAGE : undefined }, { headers: NO_STORE_HEADERS });
}
