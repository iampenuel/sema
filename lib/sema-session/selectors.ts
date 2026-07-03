import type { ConcernType, SemaSession, SignalFolderId } from "./types";

export type FolderResolution = "empty" | "in_progress" | "complete" | "not_applicable" | "needs_review";

export type PacketReadinessDecision = {
  ready: boolean;
  concernTypeSelected: boolean;
  folders: {
    story: FolderResolution;
    bodyLocation: FolderResolution;
    audio: FolderResolution;
    motionVisual: FolderResolution;
  };
  unresolvedRequirements: Array<{
    key: string;
    label: string;
    reason: string;
    recommendedAction?: string;
  }>;
  pendingReviewCount: number;
  packetStale: boolean;
  nextRequiredDestination?: "story" | "body_location" | "audio" | "motion_visual" | "review_board";
};

const folderDestinationByKey: Record<string, PacketReadinessDecision["nextRequiredDestination"]> = {
  concern: "story",
  story: "story",
  body_location: "body_location",
  audio: "audio",
  motion_visual: "motion_visual",
  review: "review_board",
  packet_stale: "review_board"
};

function statusToResolution(status: SemaSession["folderStatus"][SignalFolderId], hasContent: boolean): FolderResolution {
  if (status === "not_applicable") return "not_applicable";
  if (status === "needs_review") return "needs_review";
  if (status === "saved" || hasContent) return "complete";
  if (status === "in_progress") return "in_progress";
  return "empty";
}

function bodyRequired(concernType?: ConcernType) {
  return concernType === "pain_injury" || concernType === "skin_visible";
}

function audioRequired(concernType?: ConcernType) {
  return concernType === "cough_respiratory";
}

function motionVisualRequired(concernType?: ConcernType) {
  return concernType === "skin_visible";
}

function addUnresolved(decision: PacketReadinessDecision, key: string, label: string, reason: string, recommendedAction?: string) {
  decision.unresolvedRequirements.push({ key, label, reason, recommendedAction });
  decision.nextRequiredDestination ??= folderDestinationByKey[key];
}

export function getPacketReadinessDecision(session: SemaSession): PacketReadinessDecision {
  const pendingReviewCount =
    (session.story.summaryStatus === "needs_review" ? 1 : 0)
    + session.draftCaptures.filter((draft) => draft.status === "needs_review").length
    + (session.packetNarrativeDraft?.status === "needs_review" ? 1 : 0);
  const folders = {
    story: statusToResolution(session.folderStatus.story, Boolean(session.story.rawText.trim())),
    bodyLocation: statusToResolution(session.folderStatus.body_location, session.bodyLocation.length > 0),
    audio: statusToResolution(session.folderStatus.audio, session.audioSignals.length > 0),
    motionVisual: statusToResolution(session.folderStatus.motion_visual, session.motionVisualNotes.length + session.photoObservations.length > 0)
  };
  const decision: PacketReadinessDecision = {
    ready: false,
    concernTypeSelected: Boolean(session.concernType),
    folders,
    unresolvedRequirements: [],
    pendingReviewCount,
    packetStale: false
  };

  if (!session.concernType) addUnresolved(decision, "concern", "Concern type", "Select the concern type before preparing a packet.", "Choose the concern type at the top of the workspace.");
  if (!session.story.rawText.trim()) addUnresolved(decision, "story", "Story", "Add and save your story first.", "Open Story and save patient-provided wording.");
  if (folders.story === "needs_review") addUnresolved(decision, "review", "Review Board", "Review the organized Story draft before preparing the packet.", "Open the Review Board.");

  if (bodyRequired(session.concernType) ? folders.bodyLocation !== "complete" : folders.bodyLocation !== "complete" && folders.bodyLocation !== "not_applicable") {
    addUnresolved(decision, "body_location", "Body/Location", bodyRequired(session.concernType) ? "Add a saved body/location observation for this concern." : "Add body/location evidence or explicitly mark it Not applicable.", "Open Body/Location.");
  }
  if (audioRequired(session.concernType) ? folders.audio !== "complete" : folders.audio !== "complete" && folders.audio !== "not_applicable") {
    addUnresolved(decision, "audio", "Audio", audioRequired(session.concernType) ? "Add a saved audio observation for this concern." : "Add audio evidence or explicitly mark it Not applicable.", "Open Audio.");
  }
  if (motionVisualRequired(session.concernType) ? folders.motionVisual !== "complete" : folders.motionVisual !== "complete" && folders.motionVisual !== "not_applicable") {
    addUnresolved(decision, "motion_visual", "Motion/Visual", motionVisualRequired(session.concernType) ? "Add saved motion/visual evidence for this concern." : "Add motion/visual evidence or explicitly mark it Not applicable.", "Open Motion/Visual.");
  }
  if (pendingReviewCount > 0 && !decision.unresolvedRequirements.some((item) => item.key === "review")) {
    addUnresolved(decision, "review", "Review Board", "Review pending AI-organized content before preparing the packet.", "Open the Review Board.");
  }

  decision.ready = decision.unresolvedRequirements.length === 0;
  return decision;
}

export function packetNotReadyMessage(decision: PacketReadinessDecision) {
  const missing = decision.unresolvedRequirements.map((item) => `${item.label}: ${item.reason}`).join(" ");
  return `Your packet is not ready yet. ${missing} I can open the next unfinished folder.`;
}

export function getSessionReadiness(session: SemaSession) {
  const decision = getPacketReadinessDecision(session);
  return [
    { id: "concern", label: "Concern type selected", complete: decision.concernTypeSelected },
    { id: "story", label: "Story saved", complete: decision.folders.story === "complete" },
    { id: "summary", label: "Review Board clear", complete: decision.pendingReviewCount === 0 },
    { id: "body", label: decision.folders.bodyLocation === "not_applicable" ? "Body/location marked Not applicable" : "Body/location resolved", complete: decision.folders.bodyLocation === "complete" || decision.folders.bodyLocation === "not_applicable" },
    { id: "audio", label: decision.folders.audio === "not_applicable" ? "Audio marked Not applicable" : "Audio resolved", complete: decision.folders.audio === "complete" || decision.folders.audio === "not_applicable" },
    { id: "motion", label: decision.folders.motionVisual === "not_applicable" ? "Motion/visual marked Not applicable" : "Motion/visual resolved", complete: decision.folders.motionVisual === "complete" || decision.folders.motionVisual === "not_applicable" },
    { id: "packet", label: "Packet draft prepared", complete: Boolean(session.packetDraft) },
    { id: "safety", label: "Safety note included", complete: true }
  ];
}

export function getMissingDetails(session: SemaSession) {
  const missing: string[] = [];

  if (!session.story.rawText.trim()) {
    missing.push("Story signal has not been saved.", "Timeline is missing.", "Patient concerns are missing.");
  } else if (!session.story.structuredSummary) {
    missing.push("AI-organized summary has not been generated.", "Missing details have not been reviewed.");
  } else if (session.story.summaryStatus !== "approved") {
    missing.push("The organized story summary is waiting for your review.");
  }
  if (session.bodyLocation.length === 0) missing.push("Body/location observation has not been added.");
  if (session.audioSignals.length === 0) missing.push("Audio observation has not been added.");
  if (session.folderStatus.motion_visual !== "not_applicable" && session.motionVisualNotes.length + session.photoObservations.length === 0) missing.push("Motion/visual observation has not been added or marked Not applicable.");
  if (!session.packetDraft) missing.push("Packet draft has not been prepared.");

  return missing;
}

export const getMissingFields = getMissingDetails;

export function getFolderReadout(session: SemaSession, folder: SignalFolderId) {
  switch (folder) {
    case "story":
      return session.story.rawText.trim()
        ? "Your Story Signal Folder includes your patient-provided story. I can help generate an organized summary after permission."
        : "Your Story Signal Folder is empty. You can open it and describe what happened in your own words.";
    case "body_location":
      return session.bodyLocation.length
        ? `Your Body/Location Signal Folder has ${session.bodyLocation.length} saved observation${session.bodyLocation.length === 1 ? "" : "s"}.`
        : "Your Body/Location Signal Folder has no saved observations yet.";
    case "audio":
      return session.audioSignals.length
        ? `Your Audio Signal Folder has ${session.audioSignals.length} saved observation${session.audioSignals.length === 1 ? "" : "s"}. Sema does not classify audio.`
        : "Your Audio Signal Folder has no saved signal yet. Sema does not classify audio, but you can include a recording or demo signal as an observation.";
    case "motion_visual":
      return "Motion/Visual Signal is optional in this phase. Camera-based motion capture is planned for later.";
    case "packet":
      return session.packetDraft ? "Your evidence packet draft is prepared and ready to review." : "Your evidence packet has not been prepared yet.";
  }
}
