import type { SemaSession } from "@/lib/sema-session/types";
import { getMissingDetails } from "@/lib/sema-session/selectors";
import { getSessionReadiness } from "@/lib/sema-session/selectors";
import { LIVE_TOOL_NAMES } from "./liveTools";

export type LiveSessionContext = ReturnType<typeof buildLiveSessionContext>;

export function buildLiveSessionContext(session: SemaSession, pendingPermission?: string) {
  const approvedSummary = session.story.summaryStatus === "approved" ? session.story.structuredSummary : undefined;
  return {
    route: "/session",
    activeFolder: session.activeFolder,
    concernType: session.concernType ?? "not_selected",
    folderStatus: session.folderStatus,
    approvedStory: approvedSummary ? {
      mainConcern: approvedSummary.mainConcern,
      timeline: approvedSummary.timeline.slice(0, 6).map((item) => ({ label: item.label, detail: item.detail })),
      changesOverTime: approvedSummary.changesOverTime.slice(0, 6)
    } : null,
    observations: {
      bodyLocationCount: session.bodyLocation.length,
      bodyRegions: [...new Set(session.bodyLocation.map((item) => item.regionLabel))].slice(0, 8),
      audioCount: session.audioSignals.length,
      audioTags: [...new Set(session.audioSignals.flatMap((item) => item.tags))].slice(0, 8),
      motionVisualNoteCount: session.motionVisualNotes.length
    },
    review: {
      storySummary: session.story.summaryStatus ?? "not_started",
      packetNarrative: session.packetNarrativeDraft?.status ?? "not_started",
      packetPrepared: Boolean(session.packetDraft)
    },
    packetReadiness: getSessionReadiness(session).map((item) => ({ id: item.id, complete: item.complete, optional: Boolean(item.optional) })),
    missingDetails: getMissingDetails(session).slice(0, 8),
    activeSafetyFlags: session.safetyFlags.map((flag) => ({ type: flag.type, severity: flag.severity })).slice(-8),
    pendingPermission: pendingPermission ?? null,
    allowedActions: LIVE_TOOL_NAMES
  };
}

export function diffLiveSessionContext(previous: LiveSessionContext | undefined, next: LiveSessionContext) {
  if (!previous) return JSON.stringify({ type: "sema_session_context", value: next });
  const delta = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(previous[key as keyof LiveSessionContext]) !== JSON.stringify(value)));
  return Object.keys(delta).length ? JSON.stringify({ type: "sema_session_context_delta", value: delta }) : "";
}
