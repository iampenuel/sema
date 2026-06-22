import type { ConcernType, FolderStatus, SafetyFlag, SignalFolderId } from "@/lib/sema-session/types";

export type AgentActionType =
  | "openSignalFolder"
  | "showSignalFolderOverview"
  | "readSignalFolder"
  | "readCurrentPage"
  | "readSafetyNote"
  | "listMissingDetails"
  | "generateStorySummary"
  | "generateClinicianQuestions"
  | "prepareEvidencePacket"
  | "saveDraftToFolder"
  | "readPacketSection"
  | "exportPacketPdf"
  | "clearSession"
  | "deleteAudio"
  | "sharePacket"
  | "requestMicrophonePermission"
  | "startVoiceCapture"
  | "stopVoiceCapture"
  | "cancelVoiceCapture"
  | "openVoiceDraftReview"
  | "saveVoiceDraftToFolder"
  | "discardVoiceDraft"
  | "openPhotoCapture"
  | "readPhotoObservation"
  | "blockedSafetyResponse";

export type AgentActionRiskLevel = "read_only" | "navigation" | "write" | "high_impact" | "blocked";

export type AgentAction = {
  id: string;
  type: AgentActionType;
  label: string;
  description: string;
  riskLevel: AgentActionRiskLevel;
  requiresPermission: boolean;
  payload?: Record<string, unknown>;
};

export type PermissionOutcome = "not_required" | "permission_required" | "explicit_confirmation_required" | "blocked_by_safety";

export type PermissionDecision = {
  outcome: PermissionOutcome;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
};

export type AgentResponse = {
  reply: string;
  proposedActions: AgentAction[];
  safetyFlags: SafetyFlag[];
  blocked?: boolean;
};

export type AgentContextSnapshot = {
  currentRoute: string;
  activeFolder: SignalFolderId;
  concernType?: ConcernType;
  folderStatuses: Record<SignalFolderId, FolderStatus>;
  hasStory: boolean;
  hasSummary: boolean;
  summaryApproved: boolean;
  bodyLocationObservationCount: number;
  audioSignalCount: number;
  motionVisualNoteCount: number;
  hasPacketDraft: boolean;
  missingDetails: string[];
  safetyFlags: SafetyFlag[];
  availableActions: AgentActionType[];
};
