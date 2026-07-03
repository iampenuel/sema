import type { ApprovedSessionContent } from "@/lib/ai/aiTypes";
import { getPacketReadinessDecision } from "@/lib/sema-session/selectors";
import type { SemaSession } from "@/lib/sema-session/types";

export function buildApprovedSessionContent(session: SemaSession): ApprovedSessionContent {
  return {
    concernType: session.concernType,
    patientWords: session.story.rawText,
    approvedSummary: session.story.summaryStatus === "approved" ? session.story.structuredSummary : undefined,
    bodyLocationObservations: session.bodyLocation,
    audioSignalMetadata: session.audioSignals.map(({ name, durationSeconds, tags, notes }) => ({ name, durationSeconds, tags, notes })),
    motionVisualNotes: session.motionVisualNotes,
    packetReadiness: getPacketReadinessDecision(session)
  };
}

export function fingerprintApprovedSessionContent(content: ApprovedSessionContent) {
  const value = JSON.stringify(content);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `packet-source-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function fingerprintSessionPacketSource(session: SemaSession) {
  return fingerprintApprovedSessionContent(buildApprovedSessionContent(session));
}
