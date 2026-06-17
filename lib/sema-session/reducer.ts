import type {
  AudioSignal,
  BodyMapObservation,
  ConcernType,
  EvidencePacket,
  SafetyFlag,
  SemaSession,
  SemaStep,
  StructuredSummary
} from "./types";

export type SemaSessionAction =
  | { type: "set_concern_type"; concernType: ConcernType }
  | { type: "set_step"; step: SemaStep }
  | { type: "set_story"; rawText: string }
  | { type: "set_structured_summary"; summary: StructuredSummary }
  | { type: "update_structured_summary"; summary: StructuredSummary }
  | { type: "add_body_observation"; observation: BodyMapObservation }
  | { type: "remove_body_observation"; id: string }
  | { type: "add_audio_signal"; signal: AudioSignal }
  | { type: "remove_audio_signal"; id: string }
  | { type: "set_packet"; packet: EvidencePacket }
  | { type: "add_safety_flags"; flags: SafetyFlag[] }
  | { type: "replace_session"; session: SemaSession };

function touch(session: SemaSession): SemaSession {
  return {
    ...session,
    updatedAt: new Date().toISOString()
  };
}

export function semaSessionReducer(session: SemaSession, action: SemaSessionAction): SemaSession {
  switch (action.type) {
    case "set_concern_type":
      return touch({ ...session, concernType: action.concernType, currentStep: "story" });
    case "set_step":
      return touch({ ...session, currentStep: action.step });
    case "set_story":
      return touch({ ...session, story: { ...session.story, rawText: action.rawText } });
    case "set_structured_summary":
    case "update_structured_summary":
      return touch({ ...session, story: { ...session.story, structuredSummary: action.summary } });
    case "add_body_observation":
      return touch({ ...session, bodyMap: [...session.bodyMap, action.observation] });
    case "remove_body_observation":
      return touch({ ...session, bodyMap: session.bodyMap.filter((item) => item.id !== action.id) });
    case "add_audio_signal":
      return touch({ ...session, audioSignals: [...session.audioSignals, action.signal] });
    case "remove_audio_signal":
      return touch({ ...session, audioSignals: session.audioSignals.filter((item) => item.id !== action.id) });
    case "set_packet":
      return touch({ ...session, packetDraft: action.packet, currentStep: "packet" });
    case "add_safety_flags":
      return touch({ ...session, safetyFlags: [...session.safetyFlags, ...action.flags] });
    case "replace_session":
      return action.session;
    default:
      return session;
  }
}
