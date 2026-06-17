import type { SafetyFlag, SemaSession } from "@/lib/sema-session/types";

export type AgentActionType =
  | "readCurrentPage"
  | "explainCurrentStep"
  | "readSafetyNote"
  | "listMissingFields"
  | "focusStory"
  | "focusBodyMap"
  | "focusAudio"
  | "focusPacket"
  | "generateEvidenceSummary"
  | "generateClinicianQuestions"
  | "preparePacketDraft"
  | "exportPacketPdf"
  | "clearSession";

export type AgentActionRiskLevel = "read_only" | "navigation" | "write" | "high_impact";

export type AgentAction = {
  id: string;
  type: AgentActionType;
  label: string;
  description: string;
  riskLevel: AgentActionRiskLevel;
  requiresPermission: boolean;
  payload?: Record<string, unknown>;
};

export type PermissionOutcome =
  | "not_required"
  | "permission_required"
  | "explicit_confirmation_required"
  | "blocked_by_safety";

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

export type AgentContext = {
  session: SemaSession;
  currentRoute: string;
};
