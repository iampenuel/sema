import type {
  AudioSignal,
  BodyMapObservation,
  ConcernType,
  DraftCapture,
  EvidencePacket,
  MotionVisualNote,
  PacketNarrativeDraft,
  SafetyFlag,
  SemaSession,
  SignalFolderId,
  StructuredSummary
} from "./types";
import type { PhotoObservationMetadata } from "@/lib/photo/types";

export type SemaSessionAction =
  | { type: "set_concern_type"; concernType: ConcernType }
  | { type: "open_folder"; folder: SignalFolderId }
  | { type: "update_story_raw_text"; rawText: string }
  | { type: "apply_voice_story_text"; transcript: string; mode: "append" | "replace" }
  | { type: "save_story" }
  | { type: "set_structured_summary"; summary: StructuredSummary; draft?: DraftCapture }
  | { type: "update_structured_summary"; summary: StructuredSummary }
  | { type: "approve_structured_summary" }
  | { type: "discard_structured_summary" }
  | { type: "add_body_observation"; observation: BodyMapObservation }
  | { type: "remove_body_observation"; id: string }
  | { type: "add_audio_signal"; signal: AudioSignal }
  | { type: "remove_audio_signal"; id: string }
  | { type: "add_motion_visual_note"; note: MotionVisualNote }
  | { type: "add_photo_observation"; photo: PhotoObservationMetadata }
  | { type: "update_photo_observation"; photo: PhotoObservationMetadata }
  | { type: "remove_photo_observation"; id: string }
  | { type: "add_draft_capture"; draft: DraftCapture }
  | { type: "approve_draft_capture"; id: string }
  | { type: "discard_draft_capture"; id: string }
  | { type: "set_packet"; packet: EvidencePacket }
  | { type: "set_packet_narrative_draft"; draft: PacketNarrativeDraft }
  | { type: "update_packet_narrative_draft"; draft: PacketNarrativeDraft }
  | { type: "approve_packet_narrative_draft" }
  | { type: "discard_packet_narrative_draft" }
  | { type: "add_safety_flags"; flags: SafetyFlag[] }
  | { type: "clear_safety_flags" }
  | { type: "replace_session"; session: SemaSession };

function touch(session: SemaSession): SemaSession {
  return { ...session, updatedAt: new Date().toISOString() };
}

function withFolderStatus(session: SemaSession, folder: SignalFolderId, status: SemaSession["folderStatus"][SignalFolderId]) {
  return { ...session, folderStatus: { ...session.folderStatus, [folder]: status } };
}

function invalidatePacketContent(session: SemaSession) {
  return { ...session, packetDraft: undefined, packetNarrativeDraft: undefined };
}

export function semaSessionReducer(session: SemaSession, action: SemaSessionAction): SemaSession {
  switch (action.type) {
    case "set_concern_type":
      return touch(invalidatePacketContent({ ...session, concernType: action.concernType }));
    case "open_folder":
      return touch({ ...session, activeFolder: action.folder });
    case "update_story_raw_text": {
      const hasSummary = Boolean(session.story.structuredSummary);
      const next = {
        ...session,
        story: {
          ...session.story,
          rawText: action.rawText,
          summaryStatus: hasSummary ? "needs_review" as const : undefined
        },
        packetDraft: undefined,
        packetNarrativeDraft: undefined
      };
      return touch(withFolderStatus(next, "story", action.rawText.trim() ? (hasSummary ? "needs_review" : "in_progress") : "empty"));
    }
    case "apply_voice_story_text": {
      const transcript = action.transcript.trim();
      if (!transcript) return session;
      const rawText = action.mode === "append" && session.story.rawText.trim()
        ? `${session.story.rawText.trim()}\n\n${transcript}`
        : transcript;
      const next = {
        ...session,
        story: { rawText },
        draftCaptures: session.draftCaptures.map((draft) => draft.targetFolder === "story" && draft.status === "needs_review" ? { ...draft, status: "discarded" as const } : draft),
        packetDraft: undefined,
        packetNarrativeDraft: undefined
      };
      return touch(withFolderStatus(next, "story", "saved"));
    }
    case "save_story":
      return touch(withFolderStatus(session, "story", session.story.rawText.trim() ? (session.story.summaryStatus === "needs_review" ? "needs_review" : "saved") : "empty"));
    case "set_structured_summary": {
      const drafts = action.draft ? [...session.draftCaptures, action.draft] : session.draftCaptures;
      const next = {
        ...session,
        story: { ...session.story, structuredSummary: action.summary, summaryStatus: "needs_review" as const },
        draftCaptures: drafts,
        packetDraft: undefined,
        packetNarrativeDraft: undefined
      };
      return touch(withFolderStatus(next, "story", "needs_review"));
    }
    case "update_structured_summary": {
      const next = {
        ...session,
        story: { ...session.story, structuredSummary: action.summary, summaryStatus: "needs_review" as const },
        packetDraft: undefined,
        packetNarrativeDraft: undefined
      };
      return touch(withFolderStatus(next, "story", "needs_review"));
    }
    case "approve_structured_summary": {
      const next = {
        ...session,
        story: { ...session.story, summaryStatus: "approved" as const },
        draftCaptures: session.draftCaptures.map((draft) =>
          draft.targetFolder === "story" && draft.status === "needs_review" ? { ...draft, status: "approved" as const } : draft
        ),
        packetDraft: undefined,
        packetNarrativeDraft: undefined
      };
      return touch(withFolderStatus(next, "story", "saved"));
    }
    case "discard_structured_summary": {
      const next = {
        ...session,
        story: { rawText: session.story.rawText },
        draftCaptures: session.draftCaptures.map((draft) =>
          draft.targetFolder === "story" && draft.status === "needs_review" ? { ...draft, status: "discarded" as const } : draft
        ),
        packetDraft: undefined,
        packetNarrativeDraft: undefined
      };
      return touch(withFolderStatus(next, "story", session.story.rawText.trim() ? "saved" : "empty"));
    }
    case "add_body_observation":
      return touch(withFolderStatus(invalidatePacketContent({ ...session, bodyLocation: [...session.bodyLocation, action.observation] }), "body_location", "saved"));
    case "remove_body_observation": {
      const bodyLocation = session.bodyLocation.filter((item) => item.id !== action.id);
      return touch(withFolderStatus(invalidatePacketContent({ ...session, bodyLocation }), "body_location", bodyLocation.length ? "saved" : "empty"));
    }
    case "add_audio_signal":
      return touch(withFolderStatus(invalidatePacketContent({ ...session, audioSignals: [...session.audioSignals, action.signal] }), "audio", "saved"));
    case "remove_audio_signal": {
      const audioSignals = session.audioSignals.filter((item) => item.id !== action.id);
      return touch(withFolderStatus(invalidatePacketContent({ ...session, audioSignals }), "audio", audioSignals.length ? "saved" : "empty"));
    }
    case "add_motion_visual_note":
      return touch(withFolderStatus(invalidatePacketContent({ ...session, motionVisualNotes: [...session.motionVisualNotes, action.note] }), "motion_visual", "saved"));
    case "add_photo_observation":
      return touch(withFolderStatus(invalidatePacketContent({ ...session, photoObservations: [...session.photoObservations, action.photo] }), "motion_visual", "saved"));
    case "update_photo_observation":
      return touch(invalidatePacketContent({ ...session, photoObservations: session.photoObservations.map((photo) => photo.id === action.photo.id ? action.photo : photo) }));
    case "remove_photo_observation": {
      const photoObservations = session.photoObservations.filter((photo) => photo.id !== action.id);
      const status = session.motionVisualNotes.length || photoObservations.length ? "saved" : "optional";
      return touch(withFolderStatus(invalidatePacketContent({ ...session, photoObservations }), "motion_visual", status));
    }
    case "add_draft_capture":
      return touch({ ...session, draftCaptures: [...session.draftCaptures, action.draft] });
    case "approve_draft_capture":
      return touch({ ...session, draftCaptures: session.draftCaptures.map((draft) => draft.id === action.id ? { ...draft, status: "approved" } : draft) });
    case "discard_draft_capture":
      return touch({ ...session, draftCaptures: session.draftCaptures.map((draft) => draft.id === action.id ? { ...draft, status: "discarded" } : draft) });
    case "set_packet":
      return touch(withFolderStatus({ ...session, packetDraft: action.packet }, "packet", "saved"));
    case "set_packet_narrative_draft":
      return touch({ ...session, packetNarrativeDraft: { ...action.draft, status: "needs_review" }, packetDraft: undefined });
    case "update_packet_narrative_draft":
      return touch({ ...session, packetNarrativeDraft: { ...action.draft, status: "needs_review" }, packetDraft: undefined });
    case "approve_packet_narrative_draft":
      return session.packetNarrativeDraft
        ? touch({ ...session, packetNarrativeDraft: { ...session.packetNarrativeDraft, status: "approved" }, packetDraft: undefined })
        : session;
    case "discard_packet_narrative_draft":
      return touch({ ...session, packetNarrativeDraft: undefined, packetDraft: undefined });
    case "add_safety_flags":
      return touch({ ...session, safetyFlags: [...session.safetyFlags, ...action.flags] });
    case "clear_safety_flags":
      return touch({ ...session, safetyFlags: [] });
    case "replace_session":
      return action.session;
    default:
      return session;
  }
}
