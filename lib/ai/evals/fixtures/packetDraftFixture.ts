import { createEmptySession } from "@/lib/sema-session/defaults";
import { buildApprovedSessionContent } from "@/lib/packet/approvedContent";
import type { PacketAIDraft } from "@/lib/ai/aiTypes";

export const PACKET_PATIENT_WORDS = "Yesterday afternoon, Jordan fell onto their left hand while playing basketball. Later that evening, the left wrist felt stiff and uncomfortable when rotating it or putting pressure on it. This morning, the stiffness was still present. Jordan wants to organize these observations before speaking with a clinician.";

export const PACKET_TEST_SESSION = {
  ...createEmptySession(),
  id: "synthetic-packet-session",
  concernType: "pain_injury" as const,
  story: {
    rawText: PACKET_PATIENT_WORDS,
    summaryStatus: "approved" as const,
    structuredSummary: {
      mainConcern: "Left wrist stiffness and discomfort after a fall onto the left hand while playing basketball.",
      timeline: [
        { id: "packet-time-1", label: "Yesterday afternoon", detail: "Jordan fell onto their left hand while playing basketball.", source: "ai_organized" as const },
        { id: "packet-time-2", label: "Later that evening", detail: "The left wrist felt stiff and uncomfortable when rotating or applying pressure.", source: "ai_organized" as const },
        { id: "packet-time-3", label: "This morning", detail: "The stiffness was still present.", source: "ai_organized" as const }
      ],
      affectedAreas: ["Left wrist"],
      changesOverTime: ["Stiffness began later that evening and remained present the following morning."],
      triggersOrPatterns: [],
      patientConcerns: [],
      missingDetails: [],
      clinicianQuestions: [],
      summaryNote: "AI-organized from patient-provided information only. Review before saving.",
      source: "ai_organized_from_patient_provided_information" as const
    }
  },
  bodyLocation: [{ id: "packet-body-1", regionLabel: "Left wrist", signalType: "discomfort" as const, note: "Discomfort while rotating the wrist.", source: "patient_stated" as const }],
  audioSignals: [{ id: "packet-audio-1", name: "Synthetic observation recording", durationSeconds: 8, tags: ["patient-recorded observation"], notes: "Synthetic demo metadata only.", objectUrl: "blob:must-not-leave-session", waveformPeaks: [0.1, 0.4], createdAt: "2026-01-01T00:00:00.000Z", source: "demo_simulated" as const }],
  motionVisualNotes: [{ id: "packet-motion-1", note: "The user noticed reduced comfort while rotating the wrist.", createdAt: "2026-01-01T00:00:00.000Z", source: "patient_stated" as const }],
  updatedAt: "2026-01-01T00:00:00.000Z"
};

export const PACKET_APPROVED_CONTENT = buildApprovedSessionContent(PACKET_TEST_SESSION);

export const SAFE_PACKET_AI_DRAFT: PacketAIDraft = {
  conciseNarrative: "Jordan described left wrist stiffness and discomfort after falling onto the left hand while playing basketball.",
  missingDetails: ["Whether the discomfort changed after this morning."],
  clinicianQuestions: ["Which details about the wrist observation would be most useful to keep tracking?"],
  organizationNotes: ["Organized from approved patient-provided information only."],
  safetyFlags: []
};
