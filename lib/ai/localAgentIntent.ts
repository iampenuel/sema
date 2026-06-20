import type { AgentContextSnapshot } from "@/lib/agent/agentTypes";
import type { AgentAIProposal } from "./aiTypes";

function proposal(reply: string, type: AgentAIProposal["proposedActions"][number]["type"], payload?: Record<string, unknown>): AgentAIProposal {
  return { reply, proposedActions: [{ type, payload }], safetyDisposition: "allowed", safetyFlags: [], requiresReview: false };
}

export function routeExactAgentIntent(message: string, context: AgentContextSnapshot): AgentAIProposal | null {
  const lower = message.toLowerCase().trim().replace(/[.!?]+$/, "");
  if (/^(open story|take me to (the )?story|open the story folder)$/.test(lower)) return proposal("I can open the Story Signal Folder.", "openSignalFolder", { folder: "story" });
  if (/^(open (the )?body( map| folder)?|take me to (the )?body map)$/.test(lower)) return proposal("I can open the Body/Location Signal Folder.", "openSignalFolder", { folder: "body_location" });
  if (/^(record audio|open (the )?audio( folder)?|take me to (the )?audio)$/.test(lower)) return proposal("I can open the Audio Signal Folder.", "openSignalFolder", { folder: "audio" });
  if (/^(open (the )?(motion|visual)( folder)?|take me to (the )?(motion|visual))$/.test(lower)) return proposal("I can open the Motion/Visual Signal Folder.", "openSignalFolder", { folder: "motion_visual" });
  if (/^(read (the )?safety note)$/.test(lower)) return proposal("Here is Sema's safety note.", "readSafetyNote");
  if (/^(what details are missing|what is missing)$/.test(lower)) return proposal("I can list details that may make the packet more useful.", "listMissingDetails");
  if (/^(summarize my session( so far)?|generate summary|organize my story)$/.test(lower)) return context.hasStory ? proposal("I can draft an organized summary after permission.", "generateStorySummary") : { reply: "Add patient-provided story text before generating a summary.", proposedActions: [], safetyDisposition: "allowed", safetyFlags: [], requiresReview: false };
  if (/^(prepare my packet|make packet|generate evidence packet)$/.test(lower)) return proposal("I can prepare the packet after permission.", "prepareEvidencePacket");
  if (/^(clear (the )?session|delete everything|start over)$/.test(lower)) return proposal("I can clear this browser-local session after explicit confirmation.", "clearSession");
  if (/^(download (the )?packet|export (the )?packet|export pdf)$/.test(lower)) return proposal("I can open export after explicit confirmation.", "exportPacketPdf");
  return null;
}
