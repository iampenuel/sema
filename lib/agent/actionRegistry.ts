import type { AgentAction, AgentActionType } from "./agentTypes";

type ActionMeta = Omit<AgentAction, "id" | "type" | "payload">;

export const AGENT_ACTION_REGISTRY: Record<AgentActionType, ActionMeta> = {
  readCurrentPage: {
    label: "Read current page",
    description: "Explain the current Sema workspace.",
    riskLevel: "read_only",
    requiresPermission: false
  },
  explainCurrentStep: {
    label: "Explain current step",
    description: "Explain what the current capture step is for.",
    riskLevel: "read_only",
    requiresPermission: false
  },
  readSafetyNote: {
    label: "Read safety note",
    description: "Read Sema's safety and limitations note.",
    riskLevel: "read_only",
    requiresPermission: false
  },
  listMissingFields: {
    label: "List missing details",
    description: "List missing information for the current session.",
    riskLevel: "read_only",
    requiresPermission: false
  },
  focusStory: {
    label: "Go to story",
    description: "Focus the story signal card.",
    riskLevel: "navigation",
    requiresPermission: false
  },
  focusBodyMap: {
    label: "Go to body map",
    description: "Focus the body/location signal card.",
    riskLevel: "navigation",
    requiresPermission: false
  },
  focusAudio: {
    label: "Go to audio",
    description: "Focus the audio signal card.",
    riskLevel: "navigation",
    requiresPermission: false
  },
  focusPacket: {
    label: "Go to packet",
    description: "Focus the evidence packet preview.",
    riskLevel: "navigation",
    requiresPermission: false
  },
  generateEvidenceSummary: {
    label: "Generate summary",
    description: "Generate an AI-organized summary from patient-provided story text.",
    riskLevel: "write",
    requiresPermission: true
  },
  generateClinicianQuestions: {
    label: "Generate clinician questions",
    description: "Generate clinician questions from the current patient-provided information.",
    riskLevel: "write",
    requiresPermission: true
  },
  preparePacketDraft: {
    label: "Prepare packet",
    description: "Generate an evidence packet draft from the current session.",
    riskLevel: "write",
    requiresPermission: true
  },
  exportPacketPdf: {
    label: "Export / Print",
    description: "Open the browser print dialog for the evidence packet.",
    riskLevel: "high_impact",
    requiresPermission: true
  },
  clearSession: {
    label: "Clear session",
    description: "Clear the current session from this browser session.",
    riskLevel: "high_impact",
    requiresPermission: true
  }
};

export function createAgentAction(type: AgentActionType, payload?: Record<string, unknown>): AgentAction {
  return {
    id: `action-${type}-${Date.now()}`,
    type,
    payload,
    ...AGENT_ACTION_REGISTRY[type]
  };
}
