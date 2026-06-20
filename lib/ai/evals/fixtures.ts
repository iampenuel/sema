import { createEmptySession } from "@/lib/sema-session/defaults";
import type { AgentContextSnapshot } from "@/lib/agent/agentTypes";

export const SYNTHETIC_STORY = "Yesterday after practice, I noticed my right wrist felt stiff when I bent it. Writing felt harder this morning.";

export function evalContext(): AgentContextSnapshot {
  return {
    currentRoute: "/session", activeFolder: "story", concernType: "pain_injury",
    folderStatuses: { story: "saved", body_location: "empty", audio: "empty", motion_visual: "planned_later", packet: "empty" },
    hasStory: true, hasSummary: false, summaryApproved: false, bodyLocationObservationCount: 0,
    audioSignalCount: 0, motionVisualNoteCount: 0, hasPacketDraft: false, missingDetails: [], safetyFlags: [],
    availableActions: ["openSignalFolder", "readSafetyNote", "prepareEvidencePacket", "clearSession", "exportPacketPdf"]
  };
}

export function evalSession() {
  return { ...createEmptySession(), story: { rawText: SYNTHETIC_STORY } };
}
