"use client";

import { useEffect, useMemo, useReducer } from "react";
import { DEMO_AUDIO_SIGNAL, DEMO_BODY_OBSERVATION, DEMO_CONCERN_TYPE, DEMO_STORY } from "@/lib/demo/syntheticScenario";
import { buildEvidencePacket, generateStructuredSummary } from "@/lib/packet/buildPacket";
import { createEmptySession } from "@/lib/sema-session/defaults";
import { semaSessionReducer } from "@/lib/sema-session/reducer";
import type { AudioSignal, BodyMapObservation, ConcernType, SemaSession, SemaStep, StructuredSummary } from "@/lib/sema-session/types";

const storageKey = "sema-phase-1-session";

function loadInitialSession(): SemaSession {
  if (typeof window === "undefined") {
    return createEmptySession();
  }

  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? (JSON.parse(saved) as SemaSession) : createEmptySession();
  } catch {
    return createEmptySession();
  }
}

export function useSemaSession() {
  const [session, dispatch] = useReducer(semaSessionReducer, undefined, loadInitialSession);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  }, [session]);

  return useMemo(
    () => ({
      session,
      dispatch,
      setConcernType: (concernType: ConcernType) => dispatch({ type: "set_concern_type", concernType }),
      setStep: (step: SemaStep) => dispatch({ type: "set_step", step }),
      updateStory: (rawText: string) => dispatch({ type: "set_story", rawText }),
      generateSummary: () => dispatch({ type: "set_structured_summary", summary: generateStructuredSummary(session.story.rawText) }),
      updateStructuredSummary: (summary: StructuredSummary) => dispatch({ type: "update_structured_summary", summary }),
      addBodyObservation: (observation: BodyMapObservation) => dispatch({ type: "add_body_observation", observation }),
      removeBodyObservation: (id: string) => dispatch({ type: "remove_body_observation", id }),
      addAudioSignal: (signal: AudioSignal) => dispatch({ type: "add_audio_signal", signal }),
      removeAudioSignal: (id: string) => dispatch({ type: "remove_audio_signal", id }),
      preparePacket: () => dispatch({ type: "set_packet", packet: buildEvidencePacket(session) }),
      loadDemo: () =>
        dispatch({
          type: "replace_session",
          session: {
            ...createEmptySession(),
            concernType: DEMO_CONCERN_TYPE,
            story: {
              rawText: DEMO_STORY,
              structuredSummary: generateStructuredSummary(DEMO_STORY)
            },
            bodyMap: [DEMO_BODY_OBSERVATION],
            audioSignals: [DEMO_AUDIO_SIGNAL],
            currentStep: "packet",
            updatedAt: new Date().toISOString()
          }
        }),
      clearSession: () => dispatch({ type: "replace_session", session: createEmptySession() })
    }),
    [session]
  );
}
