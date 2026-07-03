import type { SemaLiveThinkingLevel } from "./liveConfigCore";
import type { LiveIntroClientCloseReason, LiveIntroCloseInitiator } from "./liveIntroClient";
import type { LiveIntroCanonicalKind, LiveIntroProviderErrorCategory } from "./liveIntroParser";
import type { ServerFrameType, ServerJsonRootType } from "./liveIntroFrame";
import type { LiveMicrophoneBlockReason } from "./liveMicrophoneCapture";
import type { LiveMicrophoneIndicatorState, LiveVoiceStatusKey } from "./liveVoicePresentation";
import { LIVE_SYSTEM_INSTRUCTION } from "./liveSystemInstruction";
import { LIVE_FUNCTION_DECLARATIONS } from "./liveTools";

export type LiveIntroPhase =
  | "idle"
  | "player_preparing"
  | "token_requesting"
  | "socket_connecting"
  | "setup_sending"
  | "setup_waiting"
  | "intro_requesting"
  | "intro_waiting_for_audio"
  | "intro_playing"
  | "intro_drained"
  | "ready_without_microphone"
  | "completed_one_turn";

export type LiveIntroFailureBoundary =
  | "player_init_failed"
  | "audio_context_not_running"
  | "token_request_failed"
  | "token_response_invalid"
  | "websocket_connect_failed"
  | "websocket_closed_before_open"
  | "setup_send_failed"
  | "setup_rejected"
  | "setup_not_completed"
  | "intro_send_failed"
  | "no_server_response"
  | "server_response_without_model_content"
  | "transcript_without_audio_parts"
  | "audio_parts_without_data"
  | "unsupported_audio_mime"
  | "pcm_base64_decode_failed"
  | "pcm_has_no_complete_samples"
  | "pcm_decode_failed"
  | "decoded_audio_not_buffered"
  | "audio_buffer_creation_failed"
  | "buffered_audio_not_scheduled"
  | "scheduled_source_not_started"
  | "source_creation_failed"
  | "source_schedule_failed"
  | "source_started_but_not_ended"
  | "source_end_stalled_after_expected_end"
  | "audio_context_closed_unexpectedly"
  | "audio_context_resume_failed"
  | "audio_context_clock_not_advancing"
  | "player_drain_invariant_failed"
  | "player_failed_to_drain"
  | "player_drained_but_inaudible"
  | "playback_cleared_by_state_transition"
  | "socket_closed_during_intro"
  | "server_interrupted_intro"
  | "duplicate_intro_attempt"
  | "microphone_api_unavailable"
  | "microphone_permission_denied"
  | "microphone_stream_failed"
  | "microphone_processor_failed"
  | "microphone_sample_rate_invalid"
  | "microphone_resample_failed"
  | "microphone_pcm_encode_failed"
  | "microphone_chunk_send_failed"
  | "microphone_forwarded_while_blocked"
  | "no_microphone_chunks_captured"
  | "captured_but_no_chunks_forwarded"
  | "user_turn_not_detected"
  | "user_turn_not_closed"
  | "no_model_response_after_microphone"
  | "response_transcript_without_audio"
  | "duplicate_model_response"
  | "playback_started_before_microphone_blocked"
  | "listening_started_before_server_turn_complete"
  | "listening_started_before_player_drain"
  | "listening_started_before_cooldown_complete"
  | "stale_microphone_audio_forwarded"
  | "echo_loop_detected"
  | "player_failed_after_microphone_turn"
  | "socket_closed_during_microphone_turn"
  | "unknown";

export type LiveIntroDiagnostics = {
  phase: LiveIntroPhase;
  failureBoundary?: LiveIntroFailureBoundary;
  startedAt?: number;
  liveSessionStartedAt?: number;
  liveSessionElapsedMs?: number;
  configuredProductSessionLimitMs?: number;
  productSessionLimitReached?: boolean;
  connectionOpenedAt?: number;
  connectionAgeMs?: number;
  connectionGeneration?: number;
  latestServerMessageAt?: number;
  latestServerMessageAgeMs?: number;
  latestAudioPartAt?: number;
  latestAudioPartAgeMs?: number;
  latestMicrophoneForwardAt?: number;
  latestMicrophoneForwardAgeMs?: number;
  currentVoiceState?: string;
  socketReadyState?: "connecting" | "open" | "closing" | "closed" | "unknown";
  goAwayReceived?: boolean;
  goAwayTimeLeftMs?: number;
  sessionResumptionConfigured?: boolean;
  resumableHandleAvailable?: boolean;
  sessionResumptionAttemptCount?: number;
  sessionResumptionSucceeded?: boolean;
  contextWindowCompressionConfigured?: boolean;
  reconnectAttemptCount?: number;
  lastReconnectOutcome?: "not_attempted" | "manual_retry" | "failed" | "succeeded";
  noResponseWatchdogType?: "user_turn" | "tool_response" | "player_progress" | "provider_turn_completion";
  noResponseWatchdogAgeMs?: number;
  closeReasonCategory?: "intentional" | "provider" | "product_session_limit" | "error" | "unknown";
  audioContextInitStartedAt?: number;
  audioContextReadyAt?: number;
  requestedOutputSampleRate: 24000;
  actualOutputSampleRate?: number;
  audioContextState?: "running" | "suspended" | "closed" | "unknown";
  credentialRequestedAt?: number;
  credentialReceivedAt?: number;
  socketOpeningAt?: number;
  socketOpenAt?: number;
  setupSentAt?: number;
  setupCompleteAt?: number;
  introSentAt?: number;
  firstServerMessageAt?: number;
  firstAudioAt?: number;
  generationCompleteAt?: number;
  turnCompleteAt?: number;
  playbackDrainedAt?: number;
  readyAt?: number;
  introSendCount: number;
  setupSendCount: number;
  serverMessageCount: number;
  modelContentMessageCount: number;
  audioPartCount: number;
  audioPartsWithoutData: number;
  unsupportedAudioMimeCount: number;
  outputTextPartCount: number;
  decodedAudioChunkCount: number;
  decodedSampleCount: number;
  scheduledSourceCount: number;
  startedSourceCount: number;
  sourceStartCallCount?: number;
  endedSourceCount: number;
  activeOutputSourceCount?: number;
  audioContextCurrentTime?: number;
  nextStartTime?: number;
  earliestScheduledStartTime?: number;
  latestScheduledEndTime?: number;
  latestScheduledEndAudioTime?: number;
  expectedRemainingPlaybackMs?: number;
  lastSourceScheduledAt?: number;
  lastSourceEndedAt?: number;
  lastSourceScheduledAgeMs?: number;
  lastSourceEndedAgeMs?: number;
  sourceEndProgressCount?: number;
  playerState?: "idle" | "playing" | "draining" | "stalled" | "stopped" | "closed";
  suspendedAt?: number;
  resumedAt?: number;
  interruptedCount: number;
  toolCallCount: number;
  goAwayCount: number;
  sessionResumptionUpdateCount: number;
  providerErrorCount: number;
  unrecognizedServerMessageCount: number;
  firstServerFrameType?: ServerFrameType;
  firstServerFrameByteLength?: number;
  firstServerFrameNormalizationSucceeded?: boolean;
  firstServerFrameJsonParseSucceeded?: boolean;
  firstServerJsonRootType?: ServerJsonRootType;
  firstServerMessageTopLevelKeys?: string[];
  firstServerMessageTopLevelKeyCount?: number;
  firstServerMessageCanonicalKind?: LiveIntroCanonicalKind;
  setupCompletePropertyPresent?: boolean;
  firstServerProviderErrorCode?: string | number;
  firstServerProviderErrorStatus?: string;
  firstServerProviderErrorCategory?: LiveIntroProviderErrorCategory;
  microphonePermissionRequested?: boolean;
  microphonePermissionGranted?: boolean;
  microphoneStreamCreated?: boolean;
  microphoneInputSampleRate?: number;
  microphoneTransmittedSampleRate?: number;
  microphoneChannelCount?: number;
  microphoneCaptureStartedAt?: number;
  microphoneListeningStartedAt?: number;
  microphoneListeningStoppedAt?: number;
  microphoneCapturedChunkCount: number;
  microphoneForwardedChunkCount: number;
  microphoneDiscardedChunkCount: number;
  microphoneForwardedByteCount: number;
  microphoneRawFrameCount: number;
  microphoneRawSampleCount: number;
  microphoneResamplerInputFrameCount: number;
  microphoneResamplerOutputChunkCount: number;
  microphoneEncodedChunkCount: number;
  microphoneDiscardedBeforeListeningCount: number;
  microphoneDiscardedDuringOutputCount: number;
  microphoneDiscardedDuringCooldownCount: number;
  microphoneDiscardedMutedCount: number;
  microphoneDiscardedPermissionCount: number;
  microphoneDiscardedAfterEndCount: number;
  microphoneEncodeFailureCount: number;
  microphoneSendFailureCount: number;
  microphonePendingChunkCount: number;
  microphonePendingByteCount: number;
  microphoneAccountingInvariantPassed?: boolean;
  microphoneAccountingNote?: string;
  microphoneMuted: boolean;
  microphoneForwardingBlocked: boolean;
  microphoneBlockReason?: LiveMicrophoneBlockReason;
  userTurnStartDetected?: boolean;
  userTurnEndDetected?: boolean;
  userTurnClosedAt?: number;
  firstResponseAfterMicrophoneAt?: number;
  modelResponseCountAfterMicrophone: number;
  outputTurnId?: number;
  currentInteractionId?: number;
  currentInteractionKind?: "introduction" | "microphone_turn" | "tool_action" | "recovery";
  currentOutputSegmentId?: number;
  currentOutputSegmentKind?: "introduction" | "normal_response" | "tool_preamble" | "tool_continuation" | "permission_acknowledgement" | "recovery_response";
  currentOutputSegmentStatus?: "waiting_for_audio" | "receiving_audio" | "generation_complete" | "waiting_for_turn_complete" | "playing" | "draining" | "drained" | "completed" | "cancelled" | "failed";
  currentConnectionGeneration?: number;
  generationCompleteReceivedForCurrentSegment?: boolean;
  turnCompleteReceivedForCurrentSegment?: boolean;
  playerDrainedForCurrentSegment?: boolean;
  currentSegmentAudioChunkCount?: number;
  currentSegmentDecodedSampleCount?: number;
  currentSegmentScheduledSourceCount?: number;
  currentSegmentEndedSourceCount?: number;
  currentSegmentActiveSourceCount?: number;
  playerWatchdogType?: "first_audio" | "audio_arrival_stall" | "player_progress" | "turn_complete" | "tool_response";
  playerWatchdogArmedAt?: number;
  playerWatchdogDeadlineAt?: number;
  playerWatchdogExpectedRemainingMsAtArm?: number;
  playerWatchdogRearmCount?: number;
  playerWatchdogGeneration?: number;
  playerWatchdogSegmentId?: number;
  truePlayerStallCount: number;
  falsePlayerTimeoutCount: number;
  playbackProgressObserved?: boolean;
  pendingToolCallCount?: number;
  awaitingToolResponse?: boolean;
  serverTurnCompleteReceivedForOutputTurn?: boolean;
  playerDrainedForOutputTurn?: boolean;
  cooldownStartedAt?: number;
  cooldownCompletedAt?: number;
  completedOneTurn?: boolean;
  duplicateModelTurnDetected?: boolean;
  echoTurnSuspected?: boolean;
  authoritativeVoiceState?: string;
  userVisibleStatusKey?: LiveVoiceStatusKey;
  userVisibleBadgeLabelKey?: LiveVoiceStatusKey;
  microphoneForwardingAllowed?: boolean;
  microphoneIndicatorState?: LiveMicrophoneIndicatorState;
  cooldownActive?: boolean;
  statusInvariantPassed?: boolean;
  closeInitiator?: LiveIntroCloseInitiator;
  clientCloseReasonCategory?: LiveIntroClientCloseReason;
  clientCloseRequestedAt?: number;
  providerCloseObservedAt?: number;
  socketClosedDuringIntro: boolean;
  lastSocketCloseCode?: number;
};

export function createLiveIntroDiagnostics(): LiveIntroDiagnostics {
  return {
    phase: "idle",
    sessionResumptionConfigured: false,
    resumableHandleAvailable: false,
    sessionResumptionAttemptCount: 0,
    sessionResumptionSucceeded: false,
    contextWindowCompressionConfigured: true,
    reconnectAttemptCount: 0,
    lastReconnectOutcome: "not_attempted",
    requestedOutputSampleRate: 24000,
    introSendCount: 0,
    setupSendCount: 0,
    serverMessageCount: 0,
    modelContentMessageCount: 0,
    audioPartCount: 0,
    audioPartsWithoutData: 0,
    unsupportedAudioMimeCount: 0,
    outputTextPartCount: 0,
    decodedAudioChunkCount: 0,
    decodedSampleCount: 0,
    scheduledSourceCount: 0,
    startedSourceCount: 0,
    endedSourceCount: 0,
    interruptedCount: 0,
    toolCallCount: 0,
    goAwayCount: 0,
    sessionResumptionUpdateCount: 0,
    providerErrorCount: 0,
    unrecognizedServerMessageCount: 0,
    microphoneCapturedChunkCount: 0,
    microphoneForwardedChunkCount: 0,
    microphoneDiscardedChunkCount: 0,
    microphoneForwardedByteCount: 0,
    microphoneRawFrameCount: 0,
    microphoneRawSampleCount: 0,
    microphoneResamplerInputFrameCount: 0,
    microphoneResamplerOutputChunkCount: 0,
    microphoneEncodedChunkCount: 0,
    microphoneDiscardedBeforeListeningCount: 0,
    microphoneDiscardedDuringOutputCount: 0,
    microphoneDiscardedDuringCooldownCount: 0,
    microphoneDiscardedMutedCount: 0,
    microphoneDiscardedPermissionCount: 0,
    microphoneDiscardedAfterEndCount: 0,
    microphoneEncodeFailureCount: 0,
    microphoneSendFailureCount: 0,
    microphonePendingChunkCount: 0,
    microphonePendingByteCount: 0,
    microphoneMuted: false,
    microphoneForwardingBlocked: true,
    modelResponseCountAfterMicrophone: 0,
    truePlayerStallCount: 0,
    falsePlayerTimeoutCount: 0,
    socketClosedDuringIntro: false
  };
}

export function thinkingLevelForRawSetup(level: SemaLiveThinkingLevel) {
  if (level === "low") return "LOW";
  if (level === "high") return "HIGH";
  return "MEDIUM";
}

export function modelNameForRawLiveSetup(model: string) {
  if (model.startsWith("models/") || model.startsWith("tunedModels/")) return model;
  return `models/${model}`;
}

export type GeminiLiveIntroSetupMessage = {
  setup: {
    model: string;
    generationConfig: {
      responseModalities: ["AUDIO"];
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: string;
          };
        };
      };
      thinkingConfig: {
        thinkingLevel: "LOW" | "MEDIUM" | "HIGH";
      };
    };
    systemInstruction: {
      parts: Array<{ text: string }>;
    };
    outputAudioTranscription: Record<string, never>;
    tools?: Array<{ functionDeclarations: typeof LIVE_FUNCTION_DECLARATIONS }>;
  };
};

export function buildGeminiLiveIntroSetup(options: {
  model: string;
  voiceName: string;
  thinkingLevel: SemaLiveThinkingLevel;
}): GeminiLiveIntroSetupMessage {
  return {
    setup: {
      model: modelNameForRawLiveSetup(options.model),
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: options.voiceName
            }
          }
        },
        thinkingConfig: {
          thinkingLevel: thinkingLevelForRawSetup(options.thinkingLevel)
        }
      },
      systemInstruction: {
        parts: [{ text: LIVE_SYSTEM_INSTRUCTION }]
      },
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }]
    }
  };
}

export function buildGeminiLiveIntroTextMessage(text: string) {
  return { realtimeInput: { text } };
}
