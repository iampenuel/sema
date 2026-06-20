"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { DEMO_AUDIO_SIGNAL, DEMO_BODY_OBSERVATION, DEMO_CONCERN_TYPE, DEMO_STORY } from "@/lib/demo/syntheticScenario";
import { buildEvidencePacket, generateStructuredSummary } from "@/lib/packet/buildPacket";
import { createEmptySession } from "@/lib/sema-session/defaults";
import { semaSessionReducer } from "@/lib/sema-session/reducer";
import { sanitizeAudioSignal, serializeSemaSession, toPacketAudioSignal } from "@/lib/voice/audioMetadata";
import type {
  AudioSignal,
  BodyMapObservation,
  ConcernType,
  DraftCapture,
  EvidencePacket,
  MotionVisualNote,
  PacketNarrativeDraft,
  SemaSession,
  SignalFolderId,
  StructuredSummary
} from "@/lib/sema-session/types";

const storageKey = "sema-phase-1-session";

type StoredSession = Partial<SemaSession> & {
  bodyMap?: BodyMapObservation[];
  currentStep?: string;
  motionVisualNotes?: Array<MotionVisualNote | string>;
};

type StoredPacket = Partial<EvidencePacket> & { bodyMapObservations?: BodyMapObservation[] };

function draftForSummary(summary: StructuredSummary, source: DraftCapture["source"] = "agent_drafted"): DraftCapture {
  return {
    id: `draft-story-${Date.now()}`,
    targetFolder: "story",
    title: "Organized story summary",
    content: JSON.stringify(summary),
    createdAt: new Date().toISOString(),
    source,
    status: "needs_review"
  };
}

export function migrateSession(parsed: StoredSession): SemaSession {
  const base = createEmptySession();
  const bodyLocation = parsed.bodyLocation ?? parsed.bodyMap ?? [];
  const motionVisualNotes = (parsed.motionVisualNotes ?? []).map((item, index) =>
    typeof item === "string"
      ? { id: `motion-migrated-${index}`, note: item, createdAt: parsed.updatedAt ?? new Date().toISOString(), source: "patient_stated" as const }
      : item
  );
  const summary = parsed.story?.structuredSummary
    ? { ...parsed.story.structuredSummary, source: parsed.story.structuredSummary.source ?? "ai_organized_from_patient_provided_information" as const }
    : undefined;
  const activeFolder = parsed.activeFolder ?? (
    parsed.currentStep === "body_map" ? "body_location" :
    parsed.currentStep === "audio" ? "audio" :
    parsed.currentStep === "packet" ? "packet" : "story"
  );
  const storedPacket = parsed.packetDraft as StoredPacket | undefined;
  const packetDraft = storedPacket?.id ? {
    ...storedPacket,
    bodyLocationObservations: storedPacket.bodyLocationObservations ?? storedPacket.bodyMapObservations ?? [],
    audioSignals: (storedPacket.audioSignals ?? []).map((signal, index) => toPacketAudioSignal(sanitizeAudioSignal(signal, index))),
    motionVisualNotes: storedPacket.motionVisualNotes ?? [],
    missingDetails: storedPacket.missingDetails ?? storedPacket.aiOrganizedSummary?.missingDetails ?? [],
    clinicianQuestions: storedPacket.clinicianQuestions ?? storedPacket.aiOrganizedSummary?.clinicianQuestions ?? [],
    safetyNote: storedPacket.safetyNote ?? "",
    limitations: storedPacket.limitations ?? [],
    patientWords: storedPacket.patientWords ?? "",
    generatedAt: storedPacket.generatedAt ?? new Date().toISOString(),
    label: "generated_from_patient_provided_information" as const
  } as EvidencePacket : undefined;

  return {
    ...base,
    ...parsed,
    activeFolder,
    story: {
      rawText: parsed.story?.rawText ?? "",
      structuredSummary: summary,
      summaryStatus: parsed.story?.summaryStatus ?? (summary ? "approved" : undefined)
    },
    bodyLocation,
    audioSignals: (parsed.audioSignals ?? []).map((signal, index) => sanitizeAudioSignal(signal, index)),
    motionVisualNotes,
    packetDraft,
    packetNarrativeDraft: parsed.packetNarrativeDraft?.contentFingerprint ? parsed.packetNarrativeDraft : undefined,
    draftCaptures: parsed.draftCaptures ?? [],
    safetyFlags: parsed.safetyFlags ?? [],
    folderStatus: {
      story: summary || parsed.story?.rawText?.trim() ? "saved" : "empty",
      body_location: bodyLocation.length ? "saved" : "empty",
      audio: parsed.audioSignals?.length ? "saved" : "empty",
      motion_visual: motionVisualNotes.length ? "saved" : "planned_later",
      packet: packetDraft ? "saved" : "empty",
      ...parsed.folderStatus
    }
  };
}

export function useSemaSession() {
  const [session, dispatch] = useReducer(semaSessionReducer, undefined, createEmptySession);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) dispatch({ type: "replace_session", session: migrateSession(JSON.parse(saved) as StoredSession) });
      } catch {
        window.localStorage.removeItem(storageKey);
      } finally {
        hydratedRef.current = true;
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (hydratedRef.current) window.localStorage.setItem(storageKey, serializeSemaSession(session));
  }, [session]);

  return useMemo(
    () => ({
      session,
      dispatch,
      setConcernType: (concernType: ConcernType) => dispatch({ type: "set_concern_type", concernType }),
      openFolder: (folder: SignalFolderId) => dispatch({ type: "open_folder", folder }),
      updateStory: (rawText: string) => dispatch({ type: "update_story_raw_text", rawText }),
      applyVoiceStoryText: (transcript: string, mode: "append" | "replace") => dispatch({ type: "apply_voice_story_text", transcript, mode }),
      saveStory: () => dispatch({ type: "save_story" }),
      generateSummary: () => {
        const summary = generateStructuredSummary(session.story.rawText);
        dispatch({ type: "set_structured_summary", summary, draft: draftForSummary(summary) });
      },
      setSummaryDraft: (summary: StructuredSummary) => dispatch({ type: "set_structured_summary", summary, draft: draftForSummary(summary) }),
      updateStructuredSummary: (summary: StructuredSummary) => dispatch({ type: "update_structured_summary", summary }),
      approveStructuredSummary: () => dispatch({ type: "approve_structured_summary" }),
      discardStructuredSummary: () => dispatch({ type: "discard_structured_summary" }),
      setPacketNarrativeDraft: (draft: PacketNarrativeDraft) => dispatch({ type: "set_packet_narrative_draft", draft }),
      updatePacketNarrativeDraft: (draft: PacketNarrativeDraft) => dispatch({ type: "update_packet_narrative_draft", draft }),
      approvePacketNarrativeDraft: () => dispatch({ type: "approve_packet_narrative_draft" }),
      discardPacketNarrativeDraft: () => dispatch({ type: "discard_packet_narrative_draft" }),
      addBodyObservation: (observation: BodyMapObservation) => dispatch({ type: "add_body_observation", observation }),
      removeBodyObservation: (id: string) => dispatch({ type: "remove_body_observation", id }),
      addAudioSignal: (signal: AudioSignal) => dispatch({ type: "add_audio_signal", signal }),
      removeAudioSignal: (id: string) => dispatch({ type: "remove_audio_signal", id }),
      addMotionVisualNote: (note: string) => dispatch({
        type: "add_motion_visual_note",
        note: { id: `motion-${Date.now()}`, note, createdAt: new Date().toISOString(), source: "patient_stated" }
      }),
      preparePacket: () => {
        if (session.story.summaryStatus === "needs_review" || session.packetNarrativeDraft?.status === "needs_review") return false;
        dispatch({ type: "set_packet", packet: buildEvidencePacket(session) });
        return true;
      },
      loadDemo: () => {
        const summary = { ...generateStructuredSummary(DEMO_STORY), source: "demo_generated" as const };
        dispatch({
          type: "replace_session",
          session: {
            ...createEmptySession(),
            concernType: DEMO_CONCERN_TYPE,
            activeFolder: "story",
            folderStatus: { story: "needs_review", body_location: "saved", audio: "saved", motion_visual: "planned_later", packet: "empty" },
            story: { rawText: DEMO_STORY, structuredSummary: summary, summaryStatus: "needs_review" },
            bodyLocation: [DEMO_BODY_OBSERVATION],
            audioSignals: [DEMO_AUDIO_SIGNAL],
            draftCaptures: [draftForSummary(summary, "demo_generated")],
            updatedAt: new Date().toISOString()
          }
        });
      },
      clearSession: () => dispatch({ type: "replace_session", session: createEmptySession() })
    }),
    [session]
  );
}
