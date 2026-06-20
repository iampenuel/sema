import { generateStructuredSummary } from "@/lib/packet/buildPacket";
import type { AgentAIProposal, PacketAIDraft, SemaAIProvider, SemaAIResult, StoryExtractionDraft, StoryExtractionInput } from "../aiTypes";

function metadata(startedAt: number) {
  return { provider: "local" as const, model: "local-deterministic-v0.1", fallbackUsed: false, latencyMs: Date.now() - startedAt };
}

function sentenceContaining(text: string, value: string) {
  return text.split(/(?<=[.!?])\s+/).find((sentence) => sentence.toLowerCase().includes(value.toLowerCase()))?.trim() || text.slice(0, 500);
}

export class LocalAIProvider implements SemaAIProvider {
  id = "local" as const;

  async extractStory(input: StoryExtractionInput): Promise<SemaAIResult<StoryExtractionDraft>> {
    const startedAt = Date.now();
    const summary = generateStructuredSummary(input.rawText);
    const mainSupport = sentenceContaining(input.rawText, summary.mainConcern).slice(0, 500);
    const exactItems = (values: string[]) => values
      .filter((value) => !value.startsWith("Missing from") && !value.startsWith("Patient "))
      .map((value) => ({ value, supportingText: [sentenceContaining(input.rawText, value).slice(0, 500)] }));
    const draft: StoryExtractionDraft = {
      mainConcern: summary.mainConcern,
      mainConcernSupportingText: [mainSupport],
      timeline: summary.timeline.filter((item) => !item.detail.startsWith("Missing from")).map((item) => ({ label: item.label, detail: item.detail, supportingText: [sentenceContaining(input.rawText, item.detail).slice(0, 500)] })),
      affectedAreas: exactItems(summary.affectedAreas),
      changesOverTime: [],
      triggersOrPatterns: [],
      patientConcerns: [],
      missingDetails: summary.missingDetails,
      clinicianQuestions: summary.clinicianQuestions,
      summaryNote: "AI-organized from patient-provided information only. Review before saving.",
      safetyFlags: []
    };
    return { ok: true, data: draft, metadata: metadata(startedAt) };
  }

  async proposeAgentResponse(): Promise<SemaAIResult<AgentAIProposal>> {
    const startedAt = Date.now();
    return {
      ok: true,
      data: { reply: "I can help open signal folders, list missing details, prepare the packet after permission, or read the safety note.", proposedActions: [], safetyDisposition: "allowed", safetyFlags: [], requiresReview: false },
      metadata: metadata(startedAt)
    };
  }

  async draftPacketContent(input: Parameters<SemaAIProvider["draftPacketContent"]>[0]): Promise<SemaAIResult<PacketAIDraft>> {
    const startedAt = Date.now();
    const content = input.approvedSessionContent;
    const narrative = content.approvedSummary?.mainConcern || content.patientWords.trim().split(/[.!?]/)[0] || "No approved narrative content is available.";
    return {
      ok: true,
      data: {
        conciseNarrative: narrative.slice(0, 1500),
        missingDetails: content.approvedSummary?.missingDetails ?? [],
        clinicianQuestions: content.approvedSummary?.clinicianQuestions ?? [],
        organizationNotes: ["Organized locally from approved patient-provided information."],
        safetyFlags: []
      },
      metadata: metadata(startedAt)
    };
  }
}
