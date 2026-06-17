"use client";

import type { Dispatch, RefObject } from "react";
import { buildEvidencePacket, generateStructuredSummary } from "@/lib/packet/buildPacket";
import type { SemaSessionAction } from "@/lib/sema-session/reducer";
import { createEmptySession } from "@/lib/sema-session/defaults";
import type { AgentAction } from "@/lib/agent/agentTypes";

type Handlers = {
  dispatch: Dispatch<SemaSessionAction>;
  storyRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
  audioRef: RefObject<HTMLElement | null>;
  packetRef: RefObject<HTMLElement | null>;
  getSession: () => Parameters<typeof buildEvidencePacket>[0];
};

export function useAgentActions(handlers: Handlers) {
  function focus(ref: RefObject<HTMLElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function execute(action: AgentAction) {
    const session = handlers.getSession();

    switch (action.type) {
      case "focusStory":
        handlers.dispatch({ type: "set_step", step: "story" });
        focus(handlers.storyRef);
        return "Story signal is in focus.";
      case "focusBodyMap":
        handlers.dispatch({ type: "set_step", step: "body_map" });
        focus(handlers.bodyRef);
        return "Body/location signal is in focus.";
      case "focusAudio":
        handlers.dispatch({ type: "set_step", step: "audio" });
        focus(handlers.audioRef);
        return "Audio signal is in focus.";
      case "focusPacket":
        handlers.dispatch({ type: "set_step", step: "packet" });
        focus(handlers.packetRef);
        return "Evidence packet preview is in focus.";
      case "generateEvidenceSummary":
        handlers.dispatch({ type: "set_structured_summary", summary: generateStructuredSummary(session.story.rawText) });
        return "I generated an AI-organized summary from the patient-provided story.";
      case "generateClinicianQuestions": {
        const summary = session.story.structuredSummary ?? generateStructuredSummary(session.story.rawText);
        handlers.dispatch({
          type: "set_structured_summary",
          summary: {
            ...summary,
            clinicianQuestions: [
              ...summary.clinicianQuestions,
              "What context would help you understand what changed over time?",
              "Should I track location, intensity, timing, or activities before the next conversation?"
            ]
          }
        });
        return "I added clinician-facing questions without adding medical advice.";
      }
      case "preparePacketDraft":
        handlers.dispatch({ type: "set_packet", packet: buildEvidencePacket(session) });
        focus(handlers.packetRef);
        return "The evidence packet preview is ready.";
      case "exportPacketPdf":
        window.print();
        return "The browser print/export dialog has opened.";
      case "clearSession":
        handlers.dispatch({ type: "replace_session", session: createEmptySession() });
        return "This browser session has been cleared.";
      case "readCurrentPage":
      case "explainCurrentStep":
      case "readSafetyNote":
      case "listMissingFields":
      default:
        return "Done.";
    }
  }

  return { execute };
}
