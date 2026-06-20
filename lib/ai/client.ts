import type { AgentAction } from "@/lib/agent/agentTypes";
import type { ConcernType, SafetyFlag, StructuredSummary } from "@/lib/sema-session/types";
import type { AgentAIInput, AIStatus, ApprovedSessionContent, PacketAIDraft, SemaAIProviderMetadata, StoryExtractionDraft } from "./aiTypes";

type AIEnvelope<T> = { draft: T; metadata: SemaAIProviderMetadata; fallbackNotice?: string };

export class AIClientError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "AIClientError"; }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) {
    const errorBody = body && typeof body === "object" && "error" in body ? body as { error?: { code?: string; message?: string } } : null;
    throw new AIClientError(errorBody?.error?.code || "unknown_error", errorBody?.error?.message || "Sema could not complete that request.");
  }
  return body as T;
}

export async function fetchAIStatus(signal?: AbortSignal) {
  return readJson<AIStatus>(await fetch("/api/ai/status", { signal, cache: "no-store" }));
}

export async function extractStoryWithAI(rawText: string, concernType?: ConcernType, signal?: AbortSignal) {
  return readJson<AIEnvelope<StoryExtractionDraft>>(await fetch("/api/ai/extract-story", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawText, concernType }), signal
  }));
}

export async function requestAgentProposal(input: AgentAIInput, signal?: AbortSignal) {
  return readJson<{ reply: string; proposedActions: AgentAction[]; safetyFlags: SafetyFlag[]; requiresReview?: boolean; metadata: SemaAIProviderMetadata; fallbackNotice?: string }>(await fetch("/api/ai/agent", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal
  }));
}

export async function draftPacketWithAI(approvedSessionContent: ApprovedSessionContent, signal?: AbortSignal) {
  return readJson<AIEnvelope<PacketAIDraft>>(await fetch("/api/ai/draft-packet", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvedSessionContent }), signal
  }));
}

export function storyDraftToSummary(draft: StoryExtractionDraft): StructuredSummary {
  return {
    mainConcern: draft.mainConcern,
    timeline: draft.timeline.map((item, index) => ({ id: `timeline-ai-${index}`, label: item.label, detail: item.detail, source: "ai_organized" })),
    affectedAreas: draft.affectedAreas.map((item) => item.value),
    changesOverTime: draft.changesOverTime.map((item) => item.value),
    triggersOrPatterns: draft.triggersOrPatterns.map((item) => item.value),
    patientConcerns: draft.patientConcerns.map((item) => item.value),
    missingDetails: draft.missingDetails,
    clinicianQuestions: draft.clinicianQuestions,
    summaryNote: draft.summaryNote,
    source: "ai_organized_from_patient_provided_information"
  };
}
