import type { VoiceCaptureErrorCode, VoiceCaptureState, VoiceTargetFolder } from "./voiceTypes";

export type VoiceCaptureAction =
  | { type: "support_checked"; supported: boolean; transcriptSupported: boolean }
  | { type: "request_permission" }
  | { type: "permission_granted" }
  | { type: "permission_failed"; code: VoiceCaptureErrorCode; message: string }
  | { type: "start"; recordingId: string; startedAt: number; mimeType?: string }
  | { type: "tick"; elapsedSeconds: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stopping" }
  | { type: "review"; blob: Blob; objectUrl: string; durationSeconds: number; mimeType?: string; limitReached?: boolean }
  | { type: "set_transcript"; transcript: string }
  | { type: "set_interim"; transcript: string }
  | { type: "dictation_active"; active: boolean }
  | { type: "set_target"; target: VoiceTargetFolder }
  | { type: "saving" }
  | { type: "return_to_review" }
  | { type: "saved" }
  | { type: "cancelled" }
  | { type: "reset" }
  | { type: "error"; code: VoiceCaptureErrorCode; message: string };

export function createInitialVoiceState(targetFolder: VoiceTargetFolder = "audio"): VoiceCaptureState {
  return {
    status: "checking_support",
    permission: "unknown",
    elapsedSeconds: 0,
    transcriptDraft: "",
    interimTranscript: "",
    transcriptSupported: false,
    transcriptActive: false,
    targetFolder
  };
}

export function voiceCaptureReducer(state: VoiceCaptureState, action: VoiceCaptureAction): VoiceCaptureState {
  switch (action.type) {
    case "support_checked":
      return { ...state, status: action.supported ? "idle" : "permission_unavailable", permission: action.supported ? "prompt" : "unsupported", transcriptSupported: action.transcriptSupported, errorCode: action.supported ? undefined : "microphone_unsupported", errorMessage: action.supported ? undefined : "Browser recording is unavailable. You can continue with typed notes." };
    case "request_permission":
      return { ...state, status: "requesting_permission", errorCode: undefined, errorMessage: undefined };
    case "permission_granted":
      return { ...state, status: "ready", permission: "granted", errorCode: undefined, errorMessage: undefined };
    case "permission_failed":
      return { ...state, status: action.code === "permission_denied" ? "permission_denied" : "error", permission: action.code === "permission_denied" ? "denied" : state.permission, errorCode: action.code, errorMessage: action.message };
    case "start":
      return { ...state, status: "recording", recordingId: action.recordingId, startedAt: action.startedAt, elapsedSeconds: 0, mimeType: action.mimeType, audioBlob: undefined, audioObjectUrl: undefined, transcriptDraft: "", interimTranscript: "", errorCode: undefined, errorMessage: undefined, limitReached: false };
    case "tick":
      return { ...state, elapsedSeconds: action.elapsedSeconds };
    case "pause":
      return { ...state, status: "paused", transcriptActive: false };
    case "resume":
      return { ...state, status: "recording" };
    case "stopping":
      return { ...state, status: "stopping", transcriptActive: false };
    case "review":
      return { ...state, status: "reviewing", audioBlob: action.blob, audioObjectUrl: action.objectUrl, elapsedSeconds: action.durationSeconds, mimeType: action.mimeType, interimTranscript: "", transcriptActive: false, limitReached: action.limitReached, errorCode: action.limitReached ? "recording_too_long" : undefined, errorMessage: action.limitReached ? "The 3-minute public-demo recording limit was reached. Your draft is ready to review." : undefined };
    case "set_transcript":
      return { ...state, transcriptDraft: action.transcript };
    case "set_interim":
      return { ...state, interimTranscript: action.transcript };
    case "dictation_active":
      return { ...state, transcriptActive: action.active };
    case "set_target":
      return { ...state, targetFolder: action.target };
    case "saving":
      return { ...state, status: "saving" };
    case "return_to_review":
      return { ...state, status: "reviewing" };
    case "saved":
      return { ...state, status: "saved" };
    case "cancelled":
      return { ...createInitialVoiceState(state.targetFolder), status: state.permission === "denied" ? "permission_denied" : "cancelled", permission: state.permission, transcriptSupported: state.transcriptSupported, errorCode: state.permission === "denied" ? "permission_denied" : undefined, errorMessage: state.permission === "denied" ? "Microphone access was not granted. You can enable it in your browser settings or continue with typed notes." : undefined };
    case "reset":
      return { ...createInitialVoiceState(state.targetFolder), status: state.permission === "granted" ? "ready" : state.permission === "denied" ? "permission_denied" : state.permission === "unsupported" ? "permission_unavailable" : "idle", permission: state.permission, transcriptSupported: state.transcriptSupported, errorCode: state.permission === "denied" ? "permission_denied" : undefined, errorMessage: state.permission === "denied" ? "Microphone access was not granted. You can enable it in your browser settings or continue with typed notes." : undefined };
    case "error":
      return { ...state, status: "error", transcriptActive: false, errorCode: action.code, errorMessage: action.message };
    default:
      return state;
  }
}
