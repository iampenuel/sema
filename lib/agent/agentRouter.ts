import { getMissingFields } from "@/lib/sema-session/selectors";
import { SEMAPHASE_SAFETY_NOTE } from "@/lib/safety/safetyCopy";
import { detectUnsafeRequest, getSafeRedirect } from "@/lib/safety/safetyRules";
import { createAgentAction } from "./actionRegistry";
import type { AgentContext, AgentResponse } from "./agentTypes";

export function routeAgentMessage(message: string, context: AgentContext): AgentResponse {
  const safetyFlags = detectUnsafeRequest(message);

  if (safetyFlags.length > 0) {
    return {
      reply: getSafeRedirect(safetyFlags),
      proposedActions: [],
      safetyFlags,
      blocked: true
    };
  }

  const lower = message.toLowerCase();
  const { session } = context;

  if (lower.includes("missing") || lower.includes("what details")) {
    const missing = getMissingFields(session);
    return {
      reply: missing.length
        ? `These details would make the packet clearer: ${missing.join(" ")}`
        : "The main packet pieces are present. You can still edit any section before export.",
      proposedActions: [createAgentAction("listMissingFields")],
      safetyFlags: []
    };
  }

  if (lower.includes("safety")) {
    return {
      reply: SEMAPHASE_SAFETY_NOTE,
      proposedActions: [createAgentAction("readSafetyNote")],
      safetyFlags: []
    };
  }

  if (lower.includes("body")) {
    return {
      reply: "I can take you to the body/location signal card so you can record where you noticed something.",
      proposedActions: [createAgentAction("focusBodyMap")],
      safetyFlags: []
    };
  }

  if (lower.includes("audio") || lower.includes("record")) {
    return {
      reply: "I can focus the audio signal card. Audio is included only as a patient-generated observation.",
      proposedActions: [createAgentAction("focusAudio")],
      safetyFlags: []
    };
  }

  if (lower.includes("story")) {
    return {
      reply: "I can focus the story card so you can capture what happened in your own words.",
      proposedActions: [createAgentAction("focusStory")],
      safetyFlags: []
    };
  }

  if (lower.includes("question")) {
    return {
      reply: "I can generate clinician questions from the information currently in the session. This will update the AI-organized summary.",
      proposedActions: [createAgentAction("generateClinicianQuestions")],
      safetyFlags: []
    };
  }

  if (lower.includes("prepare") || lower.includes("packet") || lower.includes("document")) {
    return {
      reply: "I can prepare an evidence packet draft from the current session after you confirm.",
      proposedActions: [createAgentAction("preparePacketDraft")],
      safetyFlags: []
    };
  }

  if (lower.includes("export") || lower.includes("download") || lower.includes("print") || lower.includes("pdf")) {
    return {
      reply: "I can open the print/export flow after explicit confirmation.",
      proposedActions: [createAgentAction("exportPacketPdf")],
      safetyFlags: []
    };
  }

  if (lower.includes("clear") || lower.includes("delete") || lower.includes("start over")) {
    return {
      reply: "I can clear this browser session after explicit confirmation.",
      proposedActions: [createAgentAction("clearSession")],
      safetyFlags: []
    };
  }

  if (lower.includes("summarize") || lower.includes("summary") || lower.includes("organize")) {
    return {
      reply: session.story.rawText.trim()
        ? "I can organize the story into a structured summary after you confirm."
        : "There is no story yet. Add patient-provided words first, or load the demo story.",
      proposedActions: session.story.rawText.trim() ? [createAgentAction("generateEvidenceSummary")] : [],
      safetyFlags: []
    };
  }

  return {
    reply:
      "I can explain the workspace, list missing details, focus story/body/audio/packet sections, prepare a packet after permission, or read the safety note.",
    proposedActions: [createAgentAction("readCurrentPage")],
    safetyFlags: []
  };
}
