import { getMissingDetails } from "@/lib/sema-session/selectors";
import type { SemaSession } from "@/lib/sema-session/types";
import { AGENT_ACTION_REGISTRY } from "./actionRegistry";
import type { AgentContextSnapshot } from "./agentTypes";

export function buildAgentContext(session: SemaSession, currentRoute: string): AgentContextSnapshot {
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
    missingDetails: getMissingDetails(session),
    safetyFlags: session.safetyFlags,
    availableActions: Object.keys(AGENT_ACTION_REGISTRY) as AgentContextSnapshot["availableActions"]
  };
}
