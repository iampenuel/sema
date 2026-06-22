import type { AgentAction, AgentActionType } from "./agentTypes";

type ActionMeta = Omit<AgentAction, "id" | "type" | "payload">;

export const AGENT_ACTION_REGISTRY: Record<AgentActionType, ActionMeta> = {
  openSignalFolder: { label: "Open signal folder", description: "Open a selected signal folder.", riskLevel: "navigation", requiresPermission: false },
  showSignalFolderOverview: { label: "Show signal folders", description: "Return to the signal folder overview without changing saved content.", riskLevel: "navigation", requiresPermission: false },
  readSignalFolder: { label: "Read signal folder", description: "Summarize what is saved in a signal folder.", riskLevel: "read_only", requiresPermission: false },
  readCurrentPage: { label: "Read current page", description: "Explain the current Sema workspace.", riskLevel: "read_only", requiresPermission: false },
  readSafetyNote: { label: "Read safety note", description: "Read Sema's safety note and important disclaimers.", riskLevel: "read_only", requiresPermission: false },
  listMissingDetails: { label: "List missing details", description: "List details that may make the packet more useful.", riskLevel: "read_only", requiresPermission: false },
  generateStorySummary: { label: "Generate summary", description: "Draft an organized summary from patient-provided story text for review.", riskLevel: "write", requiresPermission: true },
  generateClinicianQuestions: { label: "Generate clinician questions", description: "Draft clinician questions from patient-provided information for review.", riskLevel: "write", requiresPermission: true },
  prepareEvidencePacket: { label: "Prepare packet", description: "Build an evidence packet draft from approved and saved signal folders.", riskLevel: "write", requiresPermission: true },
  saveDraftToFolder: { label: "Save draft", description: "Save reviewed draft content to a signal folder.", riskLevel: "write", requiresPermission: true },
  readPacketSection: { label: "Read packet section", description: "Read a section of the current packet draft.", riskLevel: "read_only", requiresPermission: false },
  exportPacketPdf: { label: "Export PDF", description: "Download a packet-only PDF to the browser's configured download location.", riskLevel: "high_impact", requiresPermission: true },
  clearSession: { label: "Clear session", description: "Clear the current session from this browser.", riskLevel: "high_impact", requiresPermission: true },
  deleteAudio: { label: "Delete audio", description: "Delete a saved audio observation.", riskLevel: "high_impact", requiresPermission: true },
  sharePacket: { label: "Share packet", description: "Share the evidence packet outside this browser.", riskLevel: "high_impact", requiresPermission: true },
  requestMicrophonePermission: { label: "Open microphone access", description: "Open the browser-local voice panel so the user can choose whether to allow microphone access.", riskLevel: "write", requiresPermission: true },
  startVoiceCapture: { label: "Open voice capture", description: "Open browser-local voice controls. Recording still starts only from a user button.", riskLevel: "write", requiresPermission: true },
  stopVoiceCapture: { label: "Stop recording", description: "Stop the active browser-local recording and open review.", riskLevel: "navigation", requiresPermission: false },
  cancelVoiceCapture: { label: "Cancel recording", description: "Cancel active browser-local recording without saving.", riskLevel: "navigation", requiresPermission: false },
  openVoiceDraftReview: { label: "Review voice draft", description: "Open the current browser-local voice draft for review.", riskLevel: "navigation", requiresPermission: false },
  saveVoiceDraftToFolder: { label: "Review voice draft for saving", description: "Open the voice review and target folder controls. The user must approve the save in the panel.", riskLevel: "write", requiresPermission: true },
  discardVoiceDraft: { label: "Discard voice draft", description: "Delete the current unsaved voice draft.", riskLevel: "high_impact", requiresPermission: true },
  openPhotoCapture: { label: "Open photo capture", description: "Open the Motion/Visual photo explanation. Camera access still requires the user's button press.", riskLevel: "navigation", requiresPermission: false },
  readPhotoObservation: { label: "Read photo observation", description: "Read user-authored photo metadata without interpreting the image.", riskLevel: "read_only", requiresPermission: false },
  blockedSafetyResponse: { label: "Blocked safety request", description: "Do not execute a request that crosses Sema's safety boundary.", riskLevel: "blocked", requiresPermission: false }
};

// Device-access actions are intentionally absent. Model proposals cannot activate the microphone.
export const MODEL_CALLABLE_AGENT_ACTIONS: AgentActionType[] = [
  "openSignalFolder", "showSignalFolderOverview", "readSignalFolder", "readCurrentPage", "readSafetyNote", "listMissingDetails",
  "generateStorySummary", "generateClinicianQuestions", "prepareEvidencePacket", "saveDraftToFolder",
  "readPacketSection", "exportPacketPdf", "clearSession", "deleteAudio", "sharePacket", "openPhotoCapture", "readPhotoObservation"
];

let actionSequence = 0;

export function createAgentAction(type: AgentActionType, payload?: Record<string, unknown>): AgentAction {
  actionSequence += 1;
  return { id: `action-${type}-${Date.now()}-${actionSequence}`, type, payload, ...AGENT_ACTION_REGISTRY[type] };
}
