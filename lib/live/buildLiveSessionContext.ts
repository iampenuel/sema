import type { SemaSession } from "@/lib/sema-session/types";
import { getMissingDetails } from "@/lib/sema-session/selectors";
import { getPacketReadinessDecision, getSessionReadiness } from "@/lib/sema-session/selectors";
import { LIVE_TOOL_NAMES } from "./liveTools";

export type LiveSessionContext = ReturnType<typeof buildLiveSessionContext>;

export function buildLiveSessionContext(session: SemaSession, pendingPermission?: string) {
  const readiness = getSessionReadiness(session);
  const packetReadiness = getPacketReadinessDecision(session);
  const completeRequired = readiness.filter((item) => !("optional" in item && item.optional));
  const completedRequired = completeRequired.filter((item) => item.complete);
  const packetStatus = session.packetNarrativeDraft?.status === "needs_review"
    ? "draft_needs_review"
    : session.packetDraft
      ? "approved"
      : completedRequired.length === completeRequired.length && completedRequired.length > 0
        ? "ready_to_prepare"
        : completedRequired.length > 0
          ? "partially_ready"
          : "not_ready";
  return {
    contextVersion: 2,
    contextKind: "application_context_not_patient_evidence",
    route: "/session",
    activeFolder: session.activeFolder,
    concernType: session.concernType,
    folderStatus: session.folderStatus,
    counts: {
      bodyObservations: session.bodyLocation.length,
      audioSignals: session.audioSignals.length,
      motionVisualItems: session.motionVisualNotes.length + session.photoObservations.length,
      reviewItems: session.draftCaptures.filter((draft) => draft.status === "needs_review").length + (session.packetNarrativeDraft?.status === "needs_review" ? 1 : 0),
      approvedReviewItems: session.draftCaptures.filter((draft) => draft.status === "approved").length + (session.packetNarrativeDraft?.status === "approved" ? 1 : 0)
    },
    packetStatus,
    packetReadiness: {
      ready: packetReadiness.ready,
      missingRequirements: packetReadiness.unresolvedRequirements.map((item) => ({ key: item.key, label: item.label, reason: item.reason })),
      nextRequiredDestination: packetReadiness.nextRequiredDestination,
      pendingReviewCount: packetReadiness.pendingReviewCount,
      packetStale: packetReadiness.packetStale
    },
    missingDetails: getMissingDetails(session).slice(0, 8),
    activeSafetyFlags: session.safetyFlags.map((flag) => ({ type: flag.type, severity: flag.severity })).slice(-8),
    pendingPermission: pendingPermission ? { actionType: pendingPermission } : undefined,
    demoMode: true,
    safetyMode: true,
    allowedActions: LIVE_TOOL_NAMES,
    contextDelivery: "read_only_tool"
  };
}

export function diffLiveSessionContext(previous: LiveSessionContext | undefined, next: LiveSessionContext) {
  if (!previous) return JSON.stringify({ type: "sema_session_context", value: next });
  const delta = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(previous[key as keyof LiveSessionContext]) !== JSON.stringify(value)));
  return Object.keys(delta).length ? JSON.stringify({ type: "sema_session_context_delta", value: delta }) : "";
}
