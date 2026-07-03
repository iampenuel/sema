import { getMissingDetails, getPacketReadinessDecision } from "@/lib/sema-session/selectors";
import type { SemaSession } from "@/lib/sema-session/types";
import { MODEL_CALLABLE_AGENT_ACTIONS } from "./actionRegistry";
import type { AgentContextSnapshot } from "./agentTypes";

export function buildAgentContext(session: SemaSession, currentRoute: string): AgentContextSnapshot {
  const packetReadiness = getPacketReadinessDecision(session);
  return {
    currentRoute,
    activeFolder: session.activeFolder,
    concernType: session.concernType,
    folderStatuses: session.folderStatus,
    hasStory: Boolean(session.story.rawText.trim()),
    hasSummary: Boolean(session.story.structuredSummary),
    summaryApproved: session.story.summaryStatus === "approved",
    bodyLocationObservationCount: session.bodyLocation.length,
    audioSignalCount: session.audioSignals.length,
    motionVisualNoteCount: session.motionVisualNotes.length,
    hasPacketDraft: Boolean(session.packetDraft),
    packetReadiness,
    missingDetails: getMissingDetails(session),
    safetyFlags: session.safetyFlags,
    availableActions: MODEL_CALLABLE_AGENT_ACTIONS
  };
}
