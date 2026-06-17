import type { AgentAction, PermissionDecision } from "./agentTypes";

export function evaluatePermission(action: AgentAction): PermissionDecision {
  if (action.riskLevel === "read_only" || action.riskLevel === "navigation") {
    return { outcome: "not_required" };
  }

  if (action.type === "preparePacketDraft") {
    return {
      outcome: "permission_required",
      message:
        "I can prepare an evidence packet from your current story, body/location observations, and audio notes. This will update your packet preview. Do you want me to continue?",
      confirmLabel: "Prepare packet",
      cancelLabel: "Cancel"
    };
  }

  if (action.type === "exportPacketPdf") {
    return {
      outcome: "explicit_confirmation_required",
      message:
        "This packet is generated from patient-provided information. It is not a diagnosis, treatment plan, or emergency guidance. Do you want to export it?",
      confirmLabel: "Export / Print",
      cancelLabel: "Cancel"
    };
  }

  if (action.type === "clearSession") {
    return {
      outcome: "explicit_confirmation_required",
      message:
        "This will clear the current session from this browser session. This cannot be undone. Please confirm before continuing.",
      confirmLabel: "Clear session",
      cancelLabel: "Cancel"
    };
  }

  return {
    outcome: "permission_required",
    message: "This will update your Sema session using patient-provided information. Do you want me to continue?",
    confirmLabel: "Continue",
    cancelLabel: "Cancel"
  };
}
