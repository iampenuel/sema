import type { AgentAction, PermissionDecision } from "./agentTypes";

export function evaluatePermission(action: AgentAction): PermissionDecision {
  if (action.riskLevel === "blocked") {
    return { outcome: "blocked_by_safety", message: "This action is blocked by Sema's safety rules." };
  }
  if (action.riskLevel === "read_only" || action.riskLevel === "navigation") return { outcome: "not_required" };

  if (action.type === "prepareEvidencePacket") {
    return {
      outcome: "permission_required",
      message: "I can prepare an evidence packet from your saved signal folders. This will update your packet preview using patient-provided information. Do you want me to continue?",
      confirmLabel: "Prepare packet",
      cancelLabel: "Cancel"
    };
  }
  if (action.type === "exportPacketPdf") {
    return {
      outcome: "explicit_confirmation_required",
      message: "This packet is generated from patient-provided information. It is not a diagnosis, treatment plan, or emergency guidance. Do you want to export it?",
      confirmLabel: "Export PDF",
      cancelLabel: "Cancel"
    };
  }
  if (action.type === "clearSession") {
    return {
      outcome: "explicit_confirmation_required",
      message: "This will clear the current session from this browser. This cannot be undone. Please confirm before continuing.",
      confirmLabel: "Clear session",
      cancelLabel: "Cancel"
    };
  }
  if (action.type === "requestMicrophonePermission" || action.type === "startVoiceCapture") {
    return {
      outcome: "permission_required",
      message: "I can open the browser-local recording panel. Microphone access and recording begin only after you use the controls there. Nothing is uploaded during this phase. Continue?",
      confirmLabel: "Open voice controls",
      cancelLabel: "Cancel"
    };
  }
  if (action.type === "saveVoiceDraftToFolder") {
    return {
      outcome: "permission_required",
      message: "I can open the voice draft for review. Nothing is saved until you review the transcript and confirm its target folder.",
      confirmLabel: "Review draft",
      cancelLabel: "Cancel"
    };
  }
  if (action.riskLevel === "high_impact") {
    return {
      outcome: "explicit_confirmation_required",
      message: "This action changes or moves saved session information. Please confirm before continuing.",
      confirmLabel: "Confirm action",
      cancelLabel: "Cancel"
    };
  }
  return {
    outcome: "permission_required",
    message: "This will update your Sema session using patient-provided information. Do you want me to continue?",
    confirmLabel: action.type === "generateStorySummary" ? "Generate summary" : "Continue",
    cancelLabel: "Cancel"
  };
}
