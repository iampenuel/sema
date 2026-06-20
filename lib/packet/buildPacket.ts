import type { EvidencePacket, SemaSession, StructuredSummary, TimelineItem } from "@/lib/sema-session/types";
import { fingerprintSessionPacketSource } from "@/lib/packet/approvedContent";
import { PACKET_LIMITATIONS, PACKET_SAFETY_NOTE } from "@/lib/safety/safetyCopy";

const missing = "Missing from current patient-provided information.";

function includesAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function firstSentence(text: string) {
  const sentence = text.split(/[.!?]/).map((part) => part.trim()).find(Boolean);
  return sentence || missing;
}

export function generateStructuredSummary(rawText: string): StructuredSummary {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const timeline: TimelineItem[] = [];

  if (includesAny(lower, ["yesterday", "today", "last night", "this morning", "after practice", "during"])) {
    timeline.push({
      id: "timeline-start",
      label: "Start or context",
      detail: firstSentence(text),
      source: "ai_organized"
    });
  }

  const affectedAreas = [
    "right wrist",
    "left wrist",
    "wrist",
    "hand",
    "thumb",
    "ankle",
    "knee",
    "skin",
    "chest",
    "throat"
  ].filter((area) => lower.includes(area));

  const changesOverTime = [];
  if (includesAny(lower, ["worse", "better", "changed", "started", "stiff"])) {
    changesOverTime.push("Patient described change over time or movement-related change in their own words.");
  }

  const triggersOrPatterns = [];
  if (includesAny(lower, ["bend", "write", "open", "night", "exercise", "practice", "walking", "movement"])) {
    triggersOrPatterns.push("Patient mentioned an activity, time, or movement pattern connected to the observation.");
  }

  const patientConcerns = [];
  if (includesAny(lower, ["worried", "concerned", "afraid", "class", "work", "practice"])) {
    patientConcerns.push("Patient expressed a worry or life-impact concern.");
  }

  const missingDetails = [
    affectedAreas.length === 0 ? "Affected area is not clearly stated." : "",
    timeline.length === 0 ? "When this started is not clearly stated." : "",
    changesOverTime.length === 0 ? "What changed over time is not clearly stated." : "",
    triggersOrPatterns.length === 0 ? "What makes it better or worse is not clearly stated." : "",
    patientConcerns.length === 0 ? "Patient concerns or goals for the visit are not clearly stated." : ""
  ].filter(Boolean);

  return {
    mainConcern: text ? firstSentence(text) : missing,
    timeline: timeline.length
      ? timeline
      : [
          {
            id: "timeline-missing",
            label: "Timeline",
            detail: missing,
            source: "ai_organized"
          }
        ],
    affectedAreas: affectedAreas.length ? Array.from(new Set(affectedAreas)) : [missing],
    changesOverTime: changesOverTime.length ? changesOverTime : [missing],
    triggersOrPatterns: triggersOrPatterns.length ? triggersOrPatterns : [missing],
    patientConcerns: patientConcerns.length ? patientConcerns : [missing],
    missingDetails: missingDetails.length ? missingDetails : ["No obvious missing fields from the demo-safe summary."],
    clinicianQuestions: [
      "What details from this story are most important for you to know?",
      "Are there symptoms, changes, or limitations I should keep tracking before or after the visit?",
      "What should I watch for that would change the care plan you recommend?"
    ],
    summaryNote: "AI-organized from patient-provided information only. No diagnosis, treatment, or urgency level was generated.",
    source: "ai_organized_from_patient_provided_information"
  };
}

type PacketBuildOptions = { now?: Date; id?: string };

export function buildEvidencePacket(session: SemaSession, options: PacketBuildOptions = {}): EvidencePacket {
  const approvedSummary = session.story.summaryStatus === "approved" ? session.story.structuredSummary : undefined;
  const approvedNarrative = session.packetNarrativeDraft?.status === "approved" && session.packetNarrativeDraft.contentFingerprint === fingerprintSessionPacketSource(session)
    ? session.packetNarrativeDraft
    : undefined;
  const now = options.now ?? new Date();
  return {
    id: options.id ?? `packet-${now.getTime()}`,
    generatedAt: now.toISOString(),
    concernType: session.concernType,
    patientWords: session.story.rawText,
    aiOrganizedSummary: approvedSummary,
    bodyLocationObservations: session.bodyLocation,
    audioSignals: session.audioSignals.map(({ id, name, durationSeconds, tags, notes, createdAt, source }) => ({ id, name, durationSeconds, tags, notes, createdAt, source })),
    motionVisualNotes: session.motionVisualNotes,
    missingDetails: Array.from(new Set([...(approvedSummary?.missingDetails ?? []), ...(approvedNarrative?.missingDetails ?? [])])),
    clinicianQuestions: Array.from(new Set([...(approvedSummary?.clinicianQuestions ?? []), ...(approvedNarrative?.clinicianQuestions ?? [])])),
    organizedNarrative: approvedNarrative?.conciseNarrative,
    organizationNotes: approvedNarrative?.organizationNotes,
    safetyNote: PACKET_SAFETY_NOTE,
    limitations: PACKET_LIMITATIONS,
    label: "generated_from_patient_provided_information"
  };
}
