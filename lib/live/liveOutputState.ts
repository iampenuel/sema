export type LiveOutputState =
  | "idle"
  | "expecting_response"
  | "waiting_for_first_audio"
  | "buffering"
  | "playing"
  | "draining"
  | "stalled"
  | "recovering_player"
  | "recovering_session"
  | "degraded_text_only"
  | "complete"
  | "error";

export type LiveOutputFailureReason =
  | "missing_audio_modality"
  | "no_audio_chunks"
  | "audio_context_suspended"
  | "audio_context_closed"
  | "decode_failure"
  | "queue_stall"
  | "playback_node_failure"
  | "stale_epoch"
  | "unknown";

export type LiveAudioFailureCategory =
  | "provider_no_audio"
  | "audio_decode_failed"
  | "audio_context_suspended"
  | "audio_context_closed"
  | "playback_not_scheduled"
  | "playback_never_started"
  | "playback_stalled"
  | "stale_epoch_rejected"
  | "connection_closed_early"
  | "unknown";

export type LiveOutputDiagnostics = {
  connectionEpoch: number;
  responseEpoch: number;
  playbackEpoch: number;
  websocketOpen: boolean;
  responseModalityIncludesAudio: boolean;
  outputTranscriptObserved: boolean;
  outputTranscriptStartedAt?: number;
  audioPartCount: number;
  firstAudioChunkReceivedAt?: number;
  lastAudioChunkReceivedAt?: number;
  audioChunkCount: number;
  decodedAudioChunkCount: number;
  decodedSampleCount: number;
  queuedAudioBytes: number;
  queueDepth: number;
  playbackScheduled: boolean;
  playbackStarted: boolean;
  playbackCompleted: boolean;
  audioContextState: "suspended" | "running" | "closed" | "unknown";
  playbackNodeCreatedAt?: number;
  playbackStartedAt?: number;
  playbackLastProgressAt?: number;
  playbackFinishedAt?: number;
  state: LiveOutputState;
  failureReason?: LiveOutputFailureReason;
  failureCategory?: LiveAudioFailureCategory;
  watchdogCategory?: LiveAudioFailureCategory;
};

export const LIVE_OUTPUT_WATCHDOG = {
  transcriptToFirstAudioMs: 1_800,
  audioChunkToPlaybackMs: 900,
  playbackProgressStallMs: 1_800,
  recoveryAttemptLimit: 1
} as const;

export const LIVE_OUTPUT_DEGRADED_MESSAGE = "Sema’s response is available as text, but no playable Live audio was received.";
export const LIVE_OUTPUT_RECONNECTING_MESSAGE = "Sema’s voice was interrupted. Reconnecting voice…";

export function createLiveOutputDiagnostics(now = Date.now()): LiveOutputDiagnostics {
  return {
    connectionEpoch: 0,
    responseEpoch: 0,
    playbackEpoch: 0,
    websocketOpen: false,
    responseModalityIncludesAudio: true,
    outputTranscriptObserved: false,
    audioPartCount: 0,
    audioChunkCount: 0,
    decodedAudioChunkCount: 0,
    decodedSampleCount: 0,
    queuedAudioBytes: 0,
    queueDepth: 0,
    playbackScheduled: false,
    playbackStarted: false,
    playbackCompleted: false,
    audioContextState: "unknown",
    state: "idle",
    playbackLastProgressAt: now
  };
}

export function estimateBase64Bytes(value: string) {
  return Math.max(0, Math.floor(value.length * 0.75));
}
