import type { LiveErrorCode, LiveRuntimeState, LiveTranscriptLine, PendingLiveAction } from "./liveTypes";

export type LiveStateAction =
  | { type: "request_consent" }
  | { type: "consent" }
  | { type: "request_microphone" }
  | { type: "request_token" }
  | { type: "connect" }
  | { type: "connected" }
  | { type: "listen" }
  | { type: "think" }
  | { type: "speak" }
  | { type: "permission"; pending: PendingLiveAction }
  | { type: "permission_resolved" }
  | { type: "transcript"; line: LiveTranscriptLine }
  | { type: "clear_transcript" }
  | { type: "mute_microphone"; muted: boolean }
  | { type: "mute_speaker"; muted: boolean }
  | { type: "interrupt" }
  | { type: "reconnect" }
  | { type: "end" }
  | { type: "error"; code: LiveErrorCode; message: string };

export const initialLiveState: LiveRuntimeState = {
  status: "idle",
  consented: false,
  microphoneMuted: false,
  speakerMuted: false,
  transcript: [],
  reconnectAttempts: 0,
  activeGeneration: 0
};

export function liveStateReducer(state: LiveRuntimeState, action: LiveStateAction): LiveRuntimeState {
  switch (action.type) {
    case "request_consent": return { ...state, status: "consent_required", error: undefined };
    case "consent": return { ...state, consented: true, error: undefined };
    case "request_microphone": return { ...state, status: "requesting_microphone", error: undefined };
    case "request_token": return { ...state, status: "requesting_token" };
    case "connect": return { ...state, status: "connecting" };
    case "connected": return { ...state, status: "listening", sessionStartedAt: Date.now(), reconnectAttempts: 0 };
    case "listen": return { ...state, status: "listening" };
    case "think": return { ...state, status: "thinking" };
    case "speak": return { ...state, status: "speaking" };
    case "permission": return { ...state, status: "awaiting_confirmation", pendingAction: action.pending };
    case "permission_resolved": return { ...state, status: "listening", pendingAction: undefined };
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
    case "mute_microphone": return { ...state, microphoneMuted: action.muted };
    case "mute_speaker": return { ...state, speakerMuted: action.muted };
    case "interrupt": return { ...state, status: "interrupted", activeGeneration: state.activeGeneration + 1 };
    case "reconnect": return { ...state, status: "reconnecting", reconnectAttempts: state.reconnectAttempts + 1 };
    case "end": return { ...state, status: "ended", pendingAction: undefined, activeGeneration: state.activeGeneration + 1 };
    case "error": return { ...state, status: action.code === "rate_limited" ? "rate_limited" : action.code === "disabled" ? "unavailable" : "error", error: { code: action.code, message: action.message }, pendingAction: undefined };
  }
}
