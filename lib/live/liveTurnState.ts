import type { LiveOutputState } from "./liveOutputState";

export type LiveTurnState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "listening"
  | "user_speaking"
  | "closing_user_turn"
  | "thinking"
  | "waiting_for_first_audio"
  | "buffering"
  | "assistant_speaking"
  | "draining"
  | "recovering_player"
  | "recovering_session"
  | "post_playback_cooldown"
  | "degraded_text_only"
  | "muted"
  | "error";

export const LIVE_POST_PLAYBACK_COOLDOWN_MS = 400;

export const LIVE_PROVIDER_VAD_CONFIG = {
  activityHandling: "NO_INTERRUPTION",
  turnCoverage: "ONLY_ACTIVITY",
  automaticVadEnabled: true,
  startOfSpeechSensitivity: "LOW",
  endOfSpeechSensitivity: "LOW",
  prefixPaddingMs: 200,
  silenceDurationMs: 650
} as const;

export const LIVE_MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 16000 }
  },
  video: false
};

export function canForwardMicrophonePcm(turnState: LiveTurnState, outputState: LiveOutputState = "idle", muted = false) {
  if (muted) return false;
  if (outputState === "waiting_for_first_audio"
    || outputState === "buffering"
    || outputState === "playing"
    || outputState === "draining"
    || outputState === "recovering_player"
    || outputState === "recovering_session"
    || outputState === "degraded_text_only"
    || outputState === "error") return false;
  return turnState === "listening" || turnState === "user_speaking";
}

export function canForwardPcm(turnState: LiveTurnState, outputState: LiveOutputState = "idle", muted = false) {
  return canForwardMicrophonePcm(turnState, outputState, muted);
}

export function clearSpeechGateAfterTurn(inputChunker: { clear(): void }) {
  inputChunker.clear();
}
