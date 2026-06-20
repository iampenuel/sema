import type { SemaAIProviderId, PacketAIDraft } from "@/lib/ai/aiTypes";
import type { PacketNarrativeDraft } from "@/lib/sema-session/types";

export function createPacketReviewDraft(draft: PacketAIDraft, provider: SemaAIProviderId, contentFingerprint: string): PacketNarrativeDraft {
  return {
    conciseNarrative: draft.conciseNarrative,
    missingDetails: draft.missingDetails,
    clinicianQuestions: draft.clinicianQuestions,
    organizationNotes: draft.organizationNotes,
    source: provider === "gemini" ? "ai_organized_from_approved_information" : "local_organized_from_approved_information",
    status: "needs_review",
    contentFingerprint
  };
}
