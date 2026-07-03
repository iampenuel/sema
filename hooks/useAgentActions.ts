"use client";

import type { Dispatch, RefObject } from "react";
import { buildEvidencePacket, generateStructuredSummary } from "@/lib/packet/buildPacket";
import { createEmptySession } from "@/lib/sema-session/defaults";
import { getFolderReadout, getMissingDetails, getPacketReadinessDecision, packetNotReadyMessage } from "@/lib/sema-session/selectors";
import type { SemaSessionAction } from "@/lib/sema-session/reducer";
import type { DraftCapture, SemaSession, SignalFolderId } from "@/lib/sema-session/types";
import { SEMAPHASE_SAFETY_NOTE } from "@/lib/safety/safetyCopy";
import type { AgentAction } from "@/lib/agent/agentTypes";
import { downloadEvidencePacketPdf } from "@/lib/packet/pdfExport";
import type { RuntimePhotoAttachment } from "@/lib/photo/types";
import { buildLiveSessionContext } from "@/lib/live/buildLiveSessionContext";

type Handlers = {
  dispatch: Dispatch<SemaSessionAction>;
  activePanelRef: RefObject<HTMLElement | null>;
  packetRef: RefObject<HTMLElement | null>;
  getSession: () => SemaSession;
  onNavigate: (folder: SignalFolderId) => Promise<{ success: boolean; destination: string; failureReason?: string }> | { success: boolean; destination: string; failureReason?: string } | void;
  onShowOverview?: () => Promise<{ success: boolean; destination: string; failureReason?: string }> | { success: boolean; destination: string; failureReason?: string } | void;
  onVoiceAction?: (action: AgentAction) => string;
  onOpenPhotoCapture?: () => void;
  onClearEphemeralPhotos?: () => void;
  getRuntimePhotoAttachments?: () => RuntimePhotoAttachment[];
};

function summaryDraft(content: unknown): DraftCapture {
  return {
    id: `draft-agent-${Date.now()}`,
    targetFolder: "story",
    title: "Agent-drafted story summary",
    content: JSON.stringify(content),
    createdAt: new Date().toISOString(),
    source: "agent_drafted",
    status: "needs_review"
  };
}

export function useAgentActions(handlers: Handlers) {
  async function navigationMessage(result: Awaited<ReturnType<Exclude<Handlers["onNavigate"], undefined>>>, success: string) {
    if (!result || result.success) return success;
    return `I changed the workspace state, but the destination did not finish moving into view (${result.failureReason ?? "unknown"}).`;
  }

  async function execute(action: AgentAction): Promise<string> {
    const session = handlers.getSession();

    switch (action.type) {
      case "openSignalFolder": {
        const folder = action.payload?.folder as SignalFolderId | undefined;
        if (!folder) return "I could not identify that folder.";
        const result = await handlers.onNavigate(folder);
        const labels: Record<SignalFolderId, string> = { story: "Story", body_location: "Body/Location", audio: "Audio", motion_visual: "Motion/Visual", packet: "Evidence Packet" };
        return navigationMessage(result, `Opened the ${labels[folder]} Signal Folder.`);
      }
      case "showSignalFolderOverview":
        return navigationMessage(await handlers.onShowOverview?.(), "Returned to the signal folder overview.");
      case "readSignalFolder": {
        const folder = action.payload?.folder as SignalFolderId | undefined;
        return folder ? getFolderReadout(session, folder) : "I could not identify that folder.";
      }
      case "listMissingDetails": {
        const missing = getMissingDetails(session);
        return missing.length ? `These details may make the packet more useful: ${missing.join(" ")}` : "No major packet details are currently missing.";
      }
      case "readSafetyNote":
        return SEMAPHASE_SAFETY_NOTE;
      case "readCurrentPage":
        return `You are in the Sema session workspace on the ${buildLiveSessionContext(session).activeFolder} area. You can add observations to signal folders, review drafts, and prepare a clinician-ready evidence packet.`;
      case "openPhotoCapture":
        await handlers.onNavigate("motion_visual");
        handlers.onOpenPhotoCapture?.();
        return "I opened the photo panel. Camera access starts only after you choose Allow camera.";
      case "readPhotoObservation": {
        const photo = session.photoObservations.find((item) => item.id === action.payload?.id) ?? session.photoObservations.at(-1);
        if (!photo) return "No approved photo observation is saved.";
        return `This patient-provided photo is not clinically analyzed. ${photo.note ? `The user's note says: ${photo.note}` : "No note was added."} It is available only in the current tab.`;
      }
      case "generateStorySummary": {
        if (!session.story.rawText.trim()) return "Add patient-provided story text before generating a summary.";
        const summary = generateStructuredSummary(session.story.rawText);
        handlers.dispatch({ type: "set_structured_summary", summary, draft: summaryDraft(summary) });
        return "I drafted an organized story summary from patient-provided information. Review and approve it before packet preparation.";
      }
      case "updatePatientStory": {
        const text = typeof action.payload?.text === "string" ? action.payload.text.trim() : "";
        if (!text) return "I could not identify the Story wording to add.";
        handlers.dispatch({
          type: "add_draft_capture",
          draft: {
            id: `draft-live-story-${Date.now()}`,
            targetFolder: "story",
            title: "Live voice Story note",
            content: text,
            createdAt: new Date().toISOString(),
            source: "voice_drafted",
            status: "needs_review"
          }
        });
        return "I added that as a Story draft for review. It is not packet-ready until you approve it.";
      }
      case "generateClinicianQuestions": {
        if (!session.story.rawText.trim()) return "Add patient-provided story text before drafting clinician questions.";
        const base = session.story.structuredSummary ?? generateStructuredSummary(session.story.rawText);
        const summary = {
          ...base,
          clinicianQuestions: Array.from(new Set([
            ...base.clinicianQuestions,
            "What context would help you understand what changed over time?",
            "Which details would be useful for me to keep tracking?"
          ]))
        };
        handlers.dispatch({ type: "set_structured_summary", summary, draft: summaryDraft(summary) });
        return "I drafted clinician questions from the saved story. Review them before they become packet-ready.";
      }
      case "prepareEvidencePacket": {
        const readiness = getPacketReadinessDecision(session);
        if (!readiness.ready) return packetNotReadyMessage(readiness);
        if (session.story.summaryStatus === "needs_review") return "The organized story summary still needs your review. Approve or discard it before preparing the packet.";
        handlers.dispatch({ type: "set_packet", packet: buildEvidencePacket(session, { enforceReadiness: true }) });
        const result = await handlers.onNavigate("packet");
        return navigationMessage(result, "The evidence packet preview is ready from saved, approved session content.");
      }
      case "saveDraftToFolder": {
        const id = action.payload?.id as string | undefined;
        if (!id) return "I could not identify that draft.";
        handlers.dispatch({ type: "approve_draft_capture", id });
        return "The reviewed draft was saved to the session.";
      }
      case "readPacketSection": {
        const packet = session.packetDraft;
        if (!packet) return "No packet draft has been prepared yet.";
        switch (action.payload?.section) {
          case "patient_words": return packet.patientWords || "No patient words are included yet.";
          case "summary": return packet.aiOrganizedSummary?.summaryNote || "No approved organized summary is included yet.";
          case "timeline": return packet.aiOrganizedSummary?.timeline.map((item) => `${item.label}: ${item.detail}`).join(" ") || "No timeline items are included yet.";
          case "body_observations": return packet.bodyLocationObservations.length ? `${packet.bodyLocationObservations.length} body/location observations are included.` : "No body/location observations are included yet.";
          case "audio_observations": return packet.audioSignals.length ? `${packet.audioSignals.length} audio observations are included. Sema does not classify audio.` : "No audio observations are included yet.";
          case "missing_details": return packet.missingDetails.length ? packet.missingDetails.join(" ") : "No missing details are currently listed.";
          case "clinician_questions": return packet.clinicianQuestions.length ? packet.clinicianQuestions.join(" ") : "No clinician questions are included yet.";
          case "safety": return `${packet.safetyNote} ${packet.limitations.join(" ")}`;
          default: return "The packet draft is available in the preview below.";
        }
      }
      case "exportPacketPdf":
        if (!getPacketReadinessDecision(session).ready) return packetNotReadyMessage(getPacketReadinessDecision(session));
        if (!session.packetDraft) return "Prepare a packet draft before exporting.";
        try {
          const filename = await downloadEvidencePacketPdf(session.packetDraft, handlers.getRuntimePhotoAttachments?.() ?? []);
          return `The evidence packet PDF was downloaded as ${filename}.`;
        } catch {
          return "I could not create the PDF. Your packet is still available in this browser.";
        }
      case "clearSession":
        handlers.onClearEphemeralPhotos?.();
        handlers.dispatch({ type: "replace_session", session: createEmptySession() });
        handlers.onNavigate("story");
        return "Session cleared from this browser.";
      case "deleteAudio": {
        const id = action.payload?.id as string | undefined;
        if (!id) return "I could not identify that audio observation.";
        handlers.dispatch({ type: "remove_audio_signal", id });
        return "The selected audio observation was deleted.";
      }
      case "sharePacket":
        if (!getPacketReadinessDecision(session).ready) return packetNotReadyMessage(getPacketReadinessDecision(session));
        return "Sharing is not connected in this local phase. The packet remains in this browser.";
      case "requestMicrophonePermission":
      case "startVoiceCapture":
      case "stopVoiceCapture":
      case "cancelVoiceCapture":
      case "openVoiceDraftReview":
      case "saveVoiceDraftToFolder":
      case "discardVoiceDraft":
        return handlers.onVoiceAction?.(action) ?? "Voice controls are unavailable on this page.";
      case "blockedSafetyResponse":
        return "This request is blocked by Sema's safety boundary.";
      default:
        return "Done.";
    }
  }

  return { execute };
}
