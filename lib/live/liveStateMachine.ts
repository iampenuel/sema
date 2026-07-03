import type { LiveErrorCode, LiveRuntimeState, LiveTranscriptLine, PendingLiveAction } from "./liveTypes";
import type { LiveIntroPhase } from "./liveIntroControl";
import type { LiveTurnState } from "./liveTurnState";
import type { LiveOutputState } from "./liveOutputState";

export type LiveStateAction =
  | { type: "request_consent" }
  | { type: "intro_phase"; phase: Exclude<LiveIntroPhase, "idle"> }
  | { type: "consent" }
  | { type: "request_microphone" }
  | { type: "request_token" }
  | { type: "connect" }
  | { type: "connected" }
  | { type: "listen" }
  | { type: "think" }
  | { type: "speak" }
  | { type: "permission"; pending: PendingLiveAction }
  | { type: "action_running" }
  | { type: "permission_resolved" }
  | { type: "transcript"; line: LiveTranscriptLine }
  | { type: "clear_transcript" }
  | { type: "mute_microphone"; muted: boolean }
  | { type: "mute_speaker"; muted: boolean }
  | { type: "turn_state"; turnState: LiveTurnState }
  | { type: "output_state"; outputState: LiveOutputState; voiceNotice?: string }
  | { type: "clear_voice_notice" }
  | { type: "interrupt" }
  | { type: "reconnect" }
  | { type: "session_complete"; message: string }
  | { type: "end" }
  | { type: "error"; code: LiveErrorCode; message: string };

export const initialLiveState: LiveRuntimeState = {
  status: "idle",
  consented: false,
  microphoneMuted: false,
  speakerMuted: false,
  transcript: [],
  reconnectAttempts: 0,
  activeGeneration: 0,
  turnState: "disconnected",
  outputState: "idle"
};

export function liveStateReducer(state: LiveRuntimeState, action: LiveStateAction): LiveRuntimeState {
  switch (action.type) {
    case "request_consent": return { ...state, status: "consent_required", error: undefined };
    case "intro_phase": return {
      ...state,
      status: action.phase,
      error: undefined,
      outputState: action.phase === "intro_playing" ? "playing" : "idle",
      voiceNotice: undefined,
      sessionStartedAt: state.sessionStartedAt ?? Date.now(),
      turnState: action.phase === "intro_playing" ? "assistant_speaking" : action.phase === "ready_without_microphone" || action.phase === "intro_drained" || action.phase === "completed_one_turn" ? "disconnected" : "thinking"
    };
    case "consent": return { ...state, consented: true, error: undefined };
    case "request_microphone": return { ...state, status: "requesting_microphone", turnState: "connecting", error: undefined };
    case "request_token": return { ...state, status: "requesting_token" };
    case "connect": return { ...state, status: "connecting", turnState: "connecting" };
    case "connected": return { ...state, status: "listening", turnState: state.microphoneMuted ? "muted" : "listening", sessionStartedAt: Date.now(), reconnectAttempts: 0 };
    case "listen": return { ...state, status: "listening", turnState: state.microphoneMuted ? "muted" : "listening" };
    case "think": return { ...state, status: "thinking", turnState: "thinking" };
    case "speak": return { ...state, status: "speaking", turnState: "assistant_speaking" };
    case "permission": return { ...state, status: "awaiting_confirmation", pendingAction: action.pending };
    case "action_running": return { ...state, status: "action_running", turnState: "thinking" };
    case "permission_resolved": return { ...state, status: "thinking", turnState: "thinking", pendingAction: undefined };
    case "transcript": {
      const previous = state.transcript[state.transcript.length - 1];
      const transcript = previous && previous.role === action.line.role && previous.text === action.line.text
        ? [...state.transcript.slice(0, -1), action.line]
        : !action.line.final && previous && previous.role === action.line.role && !previous.final
        ? [...state.transcript.slice(0, -1), action.line]
        : [...state.transcript, action.line].slice(-40);
      return { ...state, transcript };
    }
    case "clear_transcript": return { ...state, transcript: [] };
    case "mute_microphone": return { ...state, microphoneMuted: action.muted, turnState: action.muted ? "muted" : state.status === "listening" ? "listening" : state.turnState };
    case "mute_speaker": return { ...state, speakerMuted: action.muted };
    case "turn_state": return { ...state, turnState: action.turnState };
    case "output_state": return { ...state, outputState: action.outputState, voiceNotice: action.voiceNotice ?? state.voiceNotice };
    case "clear_voice_notice": return { ...state, voiceNotice: undefined, outputState: state.outputState === "degraded_text_only" ? "complete" : state.outputState };
    case "interrupt": return { ...state, status: "interrupted", turnState: state.microphoneMuted ? "muted" : "listening", activeGeneration: state.activeGeneration + 1 };
    case "reconnect": return { ...state, status: "reconnecting", turnState: "connecting", outputState: "recovering_session", reconnectAttempts: state.reconnectAttempts + 1 };
    case "session_complete": return { ...state, status: "ended", turnState: "disconnected", outputState: "complete", voiceNotice: action.message, pendingAction: undefined, activeGeneration: state.activeGeneration + 1 };
    case "end": return { ...state, status: "ended", turnState: "disconnected", outputState: "idle", voiceNotice: undefined, pendingAction: undefined, activeGeneration: state.activeGeneration + 1 };
    case "error": return { ...state, status: action.code === "rate_limited" ? "rate_limited" : action.code === "disabled" ? "unavailable" : "error", turnState: "error", error: { code: action.code, message: action.message }, pendingAction: undefined };
  }
}
