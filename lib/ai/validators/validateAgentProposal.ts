import { createAgentAction, AGENT_ACTION_REGISTRY } from "@/lib/agent/actionRegistry";
import type { AgentAction } from "@/lib/agent/agentTypes";
import type { AgentAIProposal } from "../aiTypes";

const folders = new Set(["story", "body_location", "audio", "motion_visual", "packet"]);

export function validateAgentProposal(proposal: AgentAIProposal): { ok: boolean; actions: AgentAction[]; reason?: string } {
  const actions: AgentAction[] = [];
  for (const candidate of proposal.proposedActions) {
    if (!(candidate.type in AGENT_ACTION_REGISTRY) || candidate.type === "blockedSafetyResponse") return { ok: false, actions: [], reason: "unknown_action" };
    if ((candidate.type === "openSignalFolder" || candidate.type === "readSignalFolder") && !folders.has(String(candidate.payload?.folder))) return { ok: false, actions: [], reason: "invalid_folder" };
    if ((candidate.type === "deleteAudio" || candidate.type === "saveDraftToFolder") && typeof candidate.payload?.id !== "string") return { ok: false, actions: [], reason: "invalid_id" };
    actions.push(createAgentAction(candidate.type, candidate.payload));
  }
  return { ok: true, actions };
}
