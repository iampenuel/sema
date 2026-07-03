import type { LiveIntroDiagnostics } from "./liveIntroControl";
import type { LiveRuntimeState } from "./liveTypes";

export type LiveVoiceStatusKey =
  | "idle"
  | "preparing"
  | "connecting"
  | "introducing"
  | "speaking"
  | "finishing_output"
  | "cooldown"
  | "listening"
  | "processing"
  | "permission_pending"
  | "action_running"
  | "completed"
  | "muted"
  | "stopped"
  | "recovering"
  | "error";

export type LiveMicrophoneIndicatorState = "off" | "blocked" | "listening" | "muted" | "unavailable";

export type LiveVoicePresentation = {
  statusKey: LiveVoiceStatusKey;
  badgeLabel: string;
  badgeLabelKey: LiveVoiceStatusKey;
  detailLabel: string;
  microphoneIndicator: LiveMicrophoneIndicatorState;
  microphoneForwardingAllowed: boolean;
  statusInvariantPassed: boolean;
};

export function liveMicrophoneForwardingAllowed(state: LiveRuntimeState, diagnostics: Pick<
  LiveIntroDiagnostics,
  "microphonePermissionGranted" | "microphoneStreamCreated" | "microphoneMuted" | "microphoneForwardingBlocked" | "cooldownActive" | "activeOutputSourceCount" | "completedOneTurn"
>) {
  return state.status === "listening"
    && state.turnState === "listening"
    && diagnostics.microphonePermissionGranted === true
    && diagnostics.microphoneStreamCreated === true
    && diagnostics.microphoneMuted !== true
    && diagnostics.microphoneForwardingBlocked === false
    && diagnostics.cooldownActive !== true
    && (diagnostics.activeOutputSourceCount ?? 0) === 0
    && diagnostics.completedOneTurn !== true;
}

function basePresentation(
  statusKey: LiveVoiceStatusKey,
  badgeLabel: string,
  detailLabel: string,
  microphoneIndicator: LiveMicrophoneIndicatorState,
  microphoneForwardingAllowed: boolean,
  invariant: { activeOutputSourceCount: number; outputTurnActive: boolean; completed: boolean }
): LiveVoicePresentation {
  const statusInvariantPassed = liveVoiceStatusInvariant({
    userVisibleStatusKey: statusKey,
    microphoneForwardingAllowed,
    ...invariant
  });
  return { statusKey, badgeLabel, badgeLabelKey: statusKey, detailLabel, microphoneIndicator, microphoneForwardingAllowed, statusInvariantPassed };
}

export function liveVoicePresentationForState(state: LiveRuntimeState, diagnostics: LiveIntroDiagnostics): LiveVoicePresentation {
  const activeOutputSourceCount = diagnostics.activeOutputSourceCount ?? 0;
  const microphoneForwardingAllowed = liveMicrophoneForwardingAllowed(state, diagnostics);
  const completed = state.status === "completed_one_turn" || diagnostics.completedOneTurn === true;
  const outputTurnActive = !completed && (state.status === "intro_playing" || state.status === "speaking" || state.outputState === "playing" || activeOutputSourceCount > 0 || Boolean(diagnostics.outputTurnId));
  const invariant = { activeOutputSourceCount, outputTurnActive, completed };

  if (state.error || state.status === "error" || state.status === "unavailable" || state.status === "rate_limited") {
    return basePresentation("error", "Voice unavailable", state.error?.message ?? "Live voice is unavailable right now. Text interaction remains available.", "unavailable", false, invariant);
  }
  if (completed) {
    return basePresentation("completed", "Voice check complete", "One spoken turn and one Sema response completed successfully.", "off", false, invariant);
  }
  if (state.status === "ended") {
    return basePresentation("stopped", "Voice ended", "The Live voice session has ended.", "off", false, invariant);
  }
  if (state.microphoneMuted || state.turnState === "muted") {
    return basePresentation("muted", "Microphone muted", "Microphone audio is not being forwarded.", "muted", false, invariant);
  }
  if (state.status === "awaiting_confirmation") {
    return basePresentation("permission_pending", "Waiting for your confirmation", "Use the visible confirmation controls before Sema changes anything.", "blocked", false, invariant);
  }
  if (state.status === "action_running") {
    return basePresentation("action_running", "Updating your session", "Sema is waiting for the app to finish the approved action. Your microphone is not being forwarded.", "blocked", false, invariant);
  }
  if (state.status === "reconnecting") {
    return basePresentation("recovering", "Reconnecting voice", "Sema is trying to reconnect voice. Text interaction remains available.", "blocked", false, invariant);
  }
  if (microphoneForwardingAllowed) {
    return basePresentation("listening", "Sema is listening", "Speak now. Microphone audio is being forwarded only for this listening turn.", "listening", true, invariant);
  }
  if (diagnostics.cooldownActive || state.turnState === "post_playback_cooldown") {
    return basePresentation("cooldown", "Getting ready to listen", "Sema will listen after the short transition completes.", "blocked", false, invariant);
  }
  if (state.status === "thinking") {
    return basePresentation("processing", "Sema is responding", "Your listening turn has ended. Microphone audio is no longer being forwarded.", "blocked", false, invariant);
  }
  if (state.status === "speaking" || state.status === "intro_playing" || state.outputState === "playing" || activeOutputSourceCount > 0) {
    return basePresentation("speaking", "Sema is speaking", "Sema is speaking. Your microphone is not being forwarded.", "blocked", false, invariant);
  }
  if (state.status === "intro_drained" || state.turnState === "draining") {
    return basePresentation("finishing_output", "Finishing response", "Sema is finishing the current response. Your microphone is not being forwarded.", "blocked", false, invariant);
  }
  if (state.status === "intro_requesting" || state.status === "intro_waiting_for_audio") {
    return basePresentation("introducing", "Sema is speaking", "Sema is introducing herself. Your microphone is not being forwarded.", "blocked", false, invariant);
  }
  if (state.status === "socket_connecting" || state.status === "connecting") {
    return basePresentation("connecting", "Connecting voice", "Sema is connecting to the voice session.", "off", false, invariant);
  }
  if (state.status === "player_preparing" || state.status === "requesting_microphone" || state.status === "token_requesting" || state.status === "setup_sending" || state.status === "setup_waiting" || state.status === "requesting_token") {
    return basePresentation("preparing", "Preparing voice", "Sema is getting the voice session ready.", "off", false, invariant);
  }
  if (state.status === "idle" || state.status === "consent_required") {
    return basePresentation("idle", "Voice ready", "Start Sema when you’re ready.", "off", false, invariant);
  }
  return basePresentation("stopped", "Voice ended", "The Live voice session has ended.", "off", false, invariant);
}

export function liveVoiceStatusInvariant(input: {
  userVisibleStatusKey: LiveVoiceStatusKey;
  microphoneForwardingAllowed: boolean;
  activeOutputSourceCount: number;
  outputTurnActive: boolean;
  completed: boolean;
}) {
  if (input.userVisibleStatusKey === "listening" && !input.microphoneForwardingAllowed) return false;
  if (input.microphoneForwardingAllowed && input.userVisibleStatusKey === "speaking") return false;
  if (input.userVisibleStatusKey === "speaking" && !input.outputTurnActive && input.activeOutputSourceCount < 1) return false;
  if (input.completed && (input.userVisibleStatusKey === "speaking" || input.userVisibleStatusKey === "listening")) return false;
  return true;
}
