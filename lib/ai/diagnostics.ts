import "server-only";
import type { SemaAIProviderMetadata } from "./aiTypes";

type AIDiagnostic = {
  route: "status" | "extract-story" | "agent" | "draft-packet";
  status: "success" | "fallback" | "blocked" | "rejected" | "cancelled";
  metadata?: SemaAIProviderMetadata;
  schemaValid?: boolean;
  provenanceValid?: boolean;
  safetyValid?: boolean;
};

export function logAIDiagnostic(event: AIDiagnostic) {
  const metadata = event.metadata;
  console.info("[sema-ai]", JSON.stringify({
    route: event.route,
    status: event.status,
    provider: metadata?.provider,
    model: metadata?.model,
    requestId: metadata?.requestId,
    latencyMs: metadata?.latencyMs,
    fallbackUsed: metadata?.fallbackUsed,
    schemaValid: event.schemaValid,
    provenanceValid: event.provenanceValid,
    safetyValid: event.safetyValid
  }));
}
