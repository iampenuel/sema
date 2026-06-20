import type { SemaSession, SignalFolderId } from "./types";

export function getSessionReadiness(session: SemaSession) {
  return [
    { id: "concern", label: "Concern type selected", complete: Boolean(session.concernType) },
    { id: "story", label: "Story saved", complete: session.folderStatus.story === "saved" },
    { id: "summary", label: "Organized summary approved", complete: session.story.summaryStatus === "approved" },
    { id: "body", label: "Body/location observation added", complete: session.bodyLocation.length > 0 },
    { id: "audio", label: "Audio observation added", complete: session.audioSignals.length > 0 },
    { id: "motion", label: "Motion/visual note optional", complete: session.motionVisualNotes.length > 0, optional: true },
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
