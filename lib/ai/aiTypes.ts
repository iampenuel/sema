import type { AgentActionType, AgentContextSnapshot } from "@/lib/agent/agentTypes";
import type { AudioSignal, BodyMapObservation, ConcernType, MotionVisualNote, StructuredSummary } from "@/lib/sema-session/types";

export type SemaAIProviderId = "local" | "gemini" | "gemma4";
export type SemaAIErrorCode = "provider_not_configured" | "validation_failed" | "safety_blocked" | "cancelled" | "timeout" | "rate_limited" | "provider_unavailable" | "unknown_error";

export type SemaAIRequestOptions = { signal?: AbortSignal };

export type SemaAIProviderMetadata = {
  provider: SemaAIProviderId;
  model: string;
  fallbackUsed: boolean;
  latencyMs?: number;
  requestId?: string;
};

export type SemaAIResult<T> = {
  ok: boolean;
  data?: T;
  error?: { code: SemaAIErrorCode; message: string };
  metadata: SemaAIProviderMetadata;
};

export type SupportedTextValue = { value: string; supportingText: string[] };
export type SupportedTimelineItem = { label: string; detail: string; supportingText: string[] };

export type StoryExtractionInput = { rawText: string; concernType?: ConcernType };
export type StoryExtractionDraft = {
  mainConcern: string;
  mainConcernSupportingText: string[];
  timeline: SupportedTimelineItem[];
  affectedAreas: SupportedTextValue[];
  changesOverTime: SupportedTextValue[];
  triggersOrPatterns: SupportedTextValue[];
  patientConcerns: SupportedTextValue[];
  missingDetails: string[];
  clinicianQuestions: string[];
  summaryNote: string;
  safetyFlags: string[];
};

export type ProposedActionInput = { type: AgentActionType; payload?: Record<string, unknown> };
export type AgentAIInput = { message: string; context: AgentContextSnapshot };
export type AgentAIProposal = {
  reply: string;
  proposedActions: ProposedActionInput[];
  safetyDisposition: "allowed" | "redirected" | "blocked";
  safetyFlags: string[];
  requiresReview: boolean;
};

export type ApprovedSessionContent = {
  concernType?: ConcernType;
  patientWords: string;
  approvedSummary?: StructuredSummary;
  bodyLocationObservations: BodyMapObservation[];
  audioSignalMetadata: Array<Pick<AudioSignal, "name" | "durationSeconds" | "tags" | "notes">>;
  motionVisualNotes: MotionVisualNote[];
};

export type PacketAIInput = { approvedSessionContent: ApprovedSessionContent };
export type PacketAIDraft = {
  conciseNarrative: string;
  missingDetails: string[];
  clinicianQuestions: string[];
  organizationNotes: string[];
  safetyFlags: string[];
};

export interface SemaAIProvider {
  id: SemaAIProviderId;
  extractStory(input: StoryExtractionInput, options?: SemaAIRequestOptions): Promise<SemaAIResult<StoryExtractionDraft>>;
  proposeAgentResponse(input: AgentAIInput, options?: SemaAIRequestOptions): Promise<SemaAIResult<AgentAIProposal>>;
  draftPacketContent(input: PacketAIInput, options?: SemaAIRequestOptions): Promise<SemaAIResult<PacketAIDraft>>;
}

export type AIStatus = {
  enabled: boolean;
  configuredProvider: SemaAIProviderId;
  activeProvider: SemaAIProviderId;
  model?: string;
  fallbackActive: boolean;
  reason?: string;
};
