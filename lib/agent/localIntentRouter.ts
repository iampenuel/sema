import type { SemaSession, SignalFolderId } from "@/lib/sema-session/types";
import { detectUnsafeRequest, getSafeRedirect } from "@/lib/safety/safetyRules";
import { createAgentAction } from "./actionRegistry";
import { buildAgentContext } from "./buildAgentContext";
import type { AgentResponse } from "./agentTypes";

function openFolderResponse(folder: SignalFolderId, label: string): AgentResponse {
  return {
    reply: `I can open the ${label} Signal Folder.`,
    proposedActions: [createAgentAction("openSignalFolder", { folder })],
    safetyFlags: []
  };
}

export function routeLocalIntent(message: string, session: SemaSession, currentRoute: string): AgentResponse {
  const safetyFlags = detectUnsafeRequest(message);
  if (safetyFlags.length) return { reply: getSafeRedirect(safetyFlags), proposedActions: [], safetyFlags, blocked: true };

  const lower = message.toLowerCase().trim();
  const context = buildAgentContext(session, currentRoute);

  const readMatch = lower.match(/read (?:the )?(story|body(?: map)?|audio|motion|visual|packet)(?: folder| section)?/);
  if (readMatch) {
    const token = readMatch[1];
    const folder: SignalFolderId = token === "story" ? "story" : token.startsWith("body") ? "body_location" : token === "audio" ? "audio" : token === "packet" ? "packet" : "motion_visual";
    return { reply: "I checked that signal folder.", proposedActions: [createAgentAction("readSignalFolder", { folder })], safetyFlags: [] };
  }

  if (/\b(open|take me to)\b.*\b(story)\b/.test(lower)) return openFolderResponse("story", "Story");
  if (/\b(open|take me to)\b.*\b(body|body map)\b/.test(lower)) return openFolderResponse("body_location", "Body/Location");
  if (/\b(open|take me to|record)\b.*\baudio\b/.test(lower) || lower === "record audio") return openFolderResponse("audio", "Audio");
  if (/\b(open|take me to)\b.*\b(motion|visual)\b/.test(lower)) return openFolderResponse("motion_visual", "Motion/Visual");

  if (lower.includes("missing")) {
    return {
      reply: "I checked the current session for details that may make the packet more useful.",
      proposedActions: [createAgentAction("listMissingDetails")],
      safetyFlags: []
    };
  }
  if (lower.includes("safety")) return { reply: "Here is Sema's safety note.", proposedActions: [createAgentAction("readSafetyNote")], safetyFlags: [] };
  if (lower.includes("question")) return { reply: "I can draft clinician questions from the patient-provided information after you confirm.", proposedActions: [createAgentAction("generateClinicianQuestions")], safetyFlags: [] };
  if (lower.includes("summar") || lower.includes("organize my story") || lower.includes("generate summary")) {
    return context.hasStory
      ? { reply: "I can draft an organized story summary for your review after you confirm.", proposedActions: [createAgentAction("generateStorySummary")], safetyFlags: [] }
      : { reply: "Your Story Signal Folder is empty. Add patient-provided words before generating a summary.", proposedActions: [], safetyFlags: [] };
  }
  if (lower.includes("prepare") || lower.includes("make packet") || lower.includes("generate evidence packet")) {
    return { reply: "I can prepare an evidence packet from approved and saved signal folders after you confirm.", proposedActions: [createAgentAction("prepareEvidencePacket")], safetyFlags: [] };
  }
  if (lower.includes("download") || lower.includes("export") || lower.includes("pdf")) return { reply: "I can open the packet export flow after explicit confirmation.", proposedActions: [createAgentAction("exportPacketPdf")], safetyFlags: [] };
  if (lower.includes("clear session") || lower.includes("delete everything") || lower.includes("start over")) return { reply: "I can clear this browser-local session after explicit confirmation.", proposedActions: [createAgentAction("clearSession")], safetyFlags: [] };

  return {
    reply: "I can help open signal folders, list missing details, prepare the packet after permission, or read the safety note.",
    proposedActions: [createAgentAction("readCurrentPage")],
    safetyFlags: []
  };
}
