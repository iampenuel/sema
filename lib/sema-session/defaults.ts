import type { SemaSession } from "./types";

export function createEmptySession(): SemaSession {
  return {
    id: "session-local",
    concernType: "pain_injury",
    activeFolder: "story",
    folderStatus: {
      story: "empty",
      body_location: "empty",
      audio: "empty",
      motion_visual: "planned_later",
      packet: "empty"
    },
    story: { rawText: "" },
    bodyLocation: [],
    audioSignals: [],
    motionVisualNotes: [],
    draftCaptures: [],
    safetyFlags: [],
    updatedAt: "1970-01-01T00:00:00.000Z"
  };
}
