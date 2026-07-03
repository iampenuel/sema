"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AgentAction } from "@/lib/agent/agentTypes";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import type { SemaSession, SafetyFlag } from "@/lib/sema-session/types";
import { LIVE_INTRODUCTION } from "@/lib/live/liveIntroduction";
import { initialLiveState, liveStateReducer } from "@/lib/live/liveStateMachine";
import type { LiveProvider, LivePublicStatus, LiveRuntimeState, LiveTokenResponse, LiveToolCall } from "@/lib/live/liveTypes";
import { validateLiveToolCall } from "@/lib/live/liveTools";
import { screenLiveInput } from "@/lib/live/liveSafety";
import { GeminiLiveIntroClient, type LiveIntroClientCloseReason } from "@/lib/live/liveIntroClient";
import {
  buildGeminiLiveIntroSetup,
  createLiveIntroDiagnostics,
  type LiveIntroDiagnostics,
  type LiveIntroFailureBoundary,
  type LiveIntroPhase
} from "@/lib/live/liveIntroControl";
import type { LiveIntroParsedEvent } from "@/lib/live/liveIntroParser";
import type { LiveIntroInboundMessageMetadata } from "@/lib/live/liveIntroFrame";
import { LIVE_PLAYER_DRAIN_GRACE_MS, LivePcmOutputError, LivePcmOutputPlayer, type LivePcmOutputPlayerStats } from "@/lib/live/livePcmOutputPlayer";
import {
  canForwardPhase1CMicrophonePcm,
  LiveMicrophoneCapture,
  LiveMicrophonePcmEncoder,
  type LiveMicrophoneBlockReason,
  type LiveMicrophoneVoiceState
} from "@/lib/live/liveMicrophoneCapture";
import { LiveOutputTurnGate, phase1CCooldownMs } from "@/lib/live/liveOutputTurnGate";
import { LIVE_INPUT_SAMPLE_RATE } from "@/lib/live/liveAudio";
import { liveVoicePresentationForState } from "@/lib/live/liveVoicePresentation";

declare global {
  interface Window {
    __semaLiveIntroDiagnostics?: LiveIntroDiagnostics;
  }
}

type Options = {
  session: SemaSession;
  executeAction: (action: AgentAction) => Promise<string>;
  onSafetyFlags: (flags: SafetyFlag[]) => void;
  providerFactory?: () => LiveProvider;
};

export type SemaLiveController = ReturnType<typeof useSemaLiveSession>;
export type LiveConversationMode = "single_turn_diagnostic" | "multi_turn";

const FIRST_AUDIO_TIMEOUT_MS = 20_000;
const SETUP_TIMEOUT_MS = 20_000;
const MICROPHONE_RESPONSE_TIMEOUT_MS = 20_000;

function publicStatusFallback(): LivePublicStatus {
  return {
    uiEnabled: false,
    available: false,
    provider: "gemini_live",
    model: "",
    voiceName: "",
    thinkingLevel: "medium",
    maxSessionMinutes: 10,
    publicDemoTokenEnabled: false,
    reason: "Live status is unavailable."
  };
}

function phaseToIntroductionState(phase: LiveIntroPhase) {
  if (phase === "completed_one_turn") return "delivered" as const;
  if (phase === "intro_playing" || phase === "intro_drained") return "speaking" as const;
  if (phase === "ready_without_microphone") return "delivered" as const;
  if (phase === "intro_waiting_for_audio") return "buffering" as const;
  if (phase === "intro_requesting") return "requesting" as const;
  if (phase === "idle") return "not_started" as const;
  return "waiting_for_connection" as const;
}

function safeErrorMessage(boundary: LiveIntroFailureBoundary) {
  if (boundary === "token_request_failed" || boundary === "token_response_invalid") return "Sema could not prepare a private Live voice token. Text interaction remains available.";
  if (boundary === "player_init_failed" || boundary === "audio_context_not_running") return "This browser did not start audio playback. Try again from a visible tab, or continue by text.";
  if (boundary.startsWith("microphone_") || boundary === "no_model_response_after_microphone" || boundary === "user_turn_not_closed" || boundary === "captured_but_no_chunks_forwarded") {
    return "Sema could not access the microphone for this voice session. Text interaction remains available.";
  }
  if (boundary === "transcript_without_audio_parts" || boundary === "response_transcript_without_audio") return "Sema responded with text but no playable voice audio. Text interaction remains available.";
  if (boundary === "unsupported_audio_mime" || boundary === "audio_parts_without_data" || boundary === "pcm_base64_decode_failed" || boundary === "pcm_has_no_complete_samples" || boundary === "pcm_decode_failed") {
    return "Sema received a voice response that could not be played safely. Text interaction remains available.";
  }
  if (
    boundary === "audio_buffer_creation_failed"
    || boundary === "decoded_audio_not_buffered"
    || boundary === "buffered_audio_not_scheduled"
    || boundary === "source_creation_failed"
    || boundary === "source_schedule_failed"
    || boundary === "scheduled_source_not_started"
    || boundary === "source_started_but_not_ended"
    || boundary === "source_end_stalled_after_expected_end"
    || boundary === "audio_context_closed_unexpectedly"
    || boundary === "audio_context_resume_failed"
    || boundary === "audio_context_clock_not_advancing"
    || boundary === "player_drain_invariant_failed"
    || boundary === "player_failed_to_drain"
    || boundary === "player_failed_after_microphone_turn"
  ) {
    return "Sema’s voice output could not finish playing. Your saved session information is still available, and you can continue by text.";
  }
  if (boundary === "socket_closed_during_microphone_turn" || boundary === "socket_closed_during_intro" || boundary === "server_response_without_model_content" || boundary === "server_interrupted_intro") {
    return "Sema did not receive the rest of the voice response. You can retry voice or continue by text.";
  }
  if (boundary === "duplicate_intro_attempt" || boundary === "intro_send_failed" || boundary === "no_server_response") return "Sema could not complete the voice introduction. Text interaction remains available.";
  return "Sema Live is unavailable right now. Text interaction remains available.";
}

function sanitizeTokenResponse(value: unknown): LiveTokenResponse | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string" || !record.token) return undefined;
  if (typeof record.expiresAt !== "string" || !record.expiresAt) return undefined;
  if (typeof record.model !== "string" || !record.model) return undefined;
  if (typeof record.voiceName !== "string" || !record.voiceName) return undefined;
  if (record.thinkingLevel !== "low" && record.thinkingLevel !== "medium" && record.thinkingLevel !== "high") return undefined;
  return record as LiveTokenResponse;
}

function normalizedToolArgs(args: Record<string, unknown>) {
  return JSON.stringify(Object.keys(args).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = args[key];
    return acc;
  }, {}));
}

export function useSemaLiveSession(options: Options) {
  const { session, executeAction, onSafetyFlags } = options;
  const [state, dispatch] = useReducer(liveStateReducer, initialLiveState);
  const [publicStatus, setPublicStatus] = useState<LivePublicStatus | null>(null);
  const [introductionState, setIntroductionState] = useState<"not_started" | "waiting_for_connection" | "requesting" | "buffering" | "speaking" | "draining" | "cooldown" | "delivered" | "failed_text_available">("not_started");
  const [canRetryVoiceOutput] = useState(false);
  const [voicePresentation, setVoicePresentation] = useState(() => liveVoicePresentationForState(initialLiveState, createLiveIntroDiagnostics()));
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const executeRef = useRef(executeAction);
  const diagnosticsRef = useRef(createLiveIntroDiagnostics());
  const playerRef = useRef<LivePcmOutputPlayer | undefined>(undefined);
  const clientRef = useRef<GeminiLiveIntroClient | undefined>(undefined);
  const setupResolverRef = useRef<(() => void) | undefined>(undefined);
  const setupRejecterRef = useRef<((boundary: LiveIntroFailureBoundary) => void) | undefined>(undefined);
  const firstAudioTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setupTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const microphoneResponseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const productSessionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generationCompleteRef = useRef(false);
  const turnCompleteRef = useRef(false);
  const drainingRef = useRef(false);
  const stoppedRef = useRef(false);
  const failedRef = useRef(false);
  const microphoneCaptureRef = useRef<LiveMicrophoneCapture | undefined>(undefined);
  const microphoneEncoderRef = useRef(new LiveMicrophonePcmEncoder());
  const microphoneVoiceStateRef = useRef<LiveMicrophoneVoiceState>("unavailable");
  const microphonePermissionGrantedRef = useRef(false);
  const microphoneEnabledRef = useRef(false);
  const microphoneMutedRef = useRef(false);
  const microphoneForwardingBlockedRef = useRef(true);
  const microphoneBlockReasonRef = useRef<LiveMicrophoneBlockReason>("not_listening");
  const outputGateRef = useRef(new LiveOutputTurnGate());
  const outputTurnIdRef = useRef(0);
  const modelOutputActiveRef = useRef(false);
  const playbackActiveRef = useRef(false);
  const cooldownActiveRef = useRef(false);
  const completedOneTurnRef = useRef(false);
  const microphoneTurnStartedRef = useRef(false);
  const modelResponseAfterMicrophoneStartedRef = useRef(false);
  const responseAudioPartCountRef = useRef(0);
  const conversationModeRef = useRef<LiveConversationMode>("multi_turn");
  const connectionGenerationRef = useRef(0);
  const userTurnIdRef = useRef(0);
  const actionRunningRef = useRef(false);
  const permissionPendingRef = useRef(false);
  const pendingToolRef = useRef<{ call: LiveToolCall; action: AgentAction; ledgerKey: string } | undefined>(undefined);
  const toolLedgerRef = useRef(new Map<string, { status: "received" | "validated" | "awaiting_permission" | "approved" | "cancelled" | "executing" | "completed" | "failed" | "responded"; response?: string }>());
  const playerWatchdogGenerationRef = useRef(0);
  const outputSegmentBaselineRef = useRef({
    audioPartCount: 0,
    decodedSampleCount: 0,
    scheduledSourceCount: 0,
    endedSourceCount: 0
  });

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { executeRef.current = executeAction; }, [executeAction]);

  const publishDiagnostics = useCallback((update: Partial<LiveIntroDiagnostics>) => {
    const now = Date.now();
    const started = update.liveSessionStartedAt ?? diagnosticsRef.current.liveSessionStartedAt;
    const connectionOpened = update.connectionOpenedAt ?? diagnosticsRef.current.connectionOpenedAt;
    const latestServer = update.latestServerMessageAt ?? diagnosticsRef.current.latestServerMessageAt;
    const latestAudio = update.latestAudioPartAt ?? diagnosticsRef.current.latestAudioPartAt;
    const latestMic = update.latestMicrophoneForwardAt ?? diagnosticsRef.current.latestMicrophoneForwardAt;
    diagnosticsRef.current = {
      ...diagnosticsRef.current,
      liveSessionElapsedMs: started ? now - started : diagnosticsRef.current.liveSessionElapsedMs,
      connectionAgeMs: connectionOpened ? now - connectionOpened : diagnosticsRef.current.connectionAgeMs,
      latestServerMessageAgeMs: latestServer ? now - latestServer : diagnosticsRef.current.latestServerMessageAgeMs,
      latestAudioPartAgeMs: latestAudio ? now - latestAudio : diagnosticsRef.current.latestAudioPartAgeMs,
      latestMicrophoneForwardAgeMs: latestMic ? now - latestMic : diagnosticsRef.current.latestMicrophoneForwardAgeMs,
      ...update
    };
    if (typeof window !== "undefined") window.__semaLiveIntroDiagnostics = diagnosticsRef.current;
  }, []);

  const playerDiagnostics = useCallback((stats: LivePcmOutputPlayerStats): Partial<LiveIntroDiagnostics> => {
    const now = Date.now();
    return {
      actualOutputSampleRate: stats.actualSampleRate,
      audioContextState: stats.audioContextState,
      audioContextCurrentTime: stats.audioContextCurrentTime,
      nextStartTime: stats.nextStartTime,
      earliestScheduledStartTime: stats.earliestScheduledStartTime,
      latestScheduledEndTime: stats.latestScheduledEndTime,
      latestScheduledEndAudioTime: stats.latestScheduledEndTime,
      expectedRemainingPlaybackMs: stats.expectedRemainingPlaybackMs,
      decodedAudioChunkCount: stats.decodedAudioChunkCount,
      decodedSampleCount: stats.decodedSampleCount,
      scheduledSourceCount: stats.scheduledSourceCount,
      startedSourceCount: stats.startedSourceCount,
      sourceStartCallCount: stats.sourceStartCallCount,
      endedSourceCount: stats.endedSourceCount,
      activeOutputSourceCount: stats.activeOutputSourceCount,
      currentSegmentAudioChunkCount: Math.max(0, diagnosticsRef.current.audioPartCount - outputSegmentBaselineRef.current.audioPartCount),
      currentSegmentDecodedSampleCount: Math.max(0, stats.decodedSampleCount - outputSegmentBaselineRef.current.decodedSampleCount),
      currentSegmentScheduledSourceCount: Math.max(0, stats.scheduledSourceCount - outputSegmentBaselineRef.current.scheduledSourceCount),
      currentSegmentEndedSourceCount: Math.max(0, stats.endedSourceCount - outputSegmentBaselineRef.current.endedSourceCount),
      currentSegmentActiveSourceCount: stats.activeOutputSourceCount,
      lastSourceScheduledAt: stats.lastSourceScheduledAt,
      lastSourceEndedAt: stats.lastSourceEndedAt,
      lastSourceScheduledAgeMs: stats.lastSourceScheduledAt ? now - stats.lastSourceScheduledAt : undefined,
      lastSourceEndedAgeMs: stats.lastSourceEndedAt ? now - stats.lastSourceEndedAt : undefined,
      sourceEndProgressCount: stats.sourceEndProgressCount,
      playerState: stats.playerState,
      suspendedAt: stats.suspendedAt,
      resumedAt: stats.resumedAt,
      playerWatchdogRearmCount: stats.drainWatchdogRearmCount,
      playerWatchdogGeneration: playerWatchdogGenerationRef.current,
      playerWatchdogSegmentId: diagnosticsRef.current.currentOutputSegmentId,
      truePlayerStallCount: diagnosticsRef.current.truePlayerStallCount,
      falsePlayerTimeoutCount: diagnosticsRef.current.falsePlayerTimeoutCount
    };
  }, []);

  const toolLedgerKey = useCallback((call: LiveToolCall) => {
    return `${connectionGenerationRef.current}:${call.id}:${call.name}:${normalizedToolArgs(call.args ?? {})}`;
  }, []);

  const publishMicrophoneAccounting = useCallback(() => {
    const diagnostics = diagnosticsRef.current;
    const classifiedRawFrames =
      diagnostics.microphoneForwardedChunkCount
      + diagnostics.microphoneDiscardedBeforeListeningCount
      + diagnostics.microphoneDiscardedDuringOutputCount
      + diagnostics.microphoneDiscardedDuringCooldownCount
      + diagnostics.microphoneDiscardedMutedCount
      + diagnostics.microphoneDiscardedPermissionCount
      + diagnostics.microphoneDiscardedAfterEndCount
      + diagnostics.microphoneEncodeFailureCount
      + diagnostics.microphoneSendFailureCount;
    publishDiagnostics({
      microphonePendingChunkCount: microphoneEncoderRef.current.pendingChunkCount,
      microphonePendingByteCount: microphoneEncoderRef.current.pendingByteCount,
      microphoneAccountingInvariantPassed: diagnostics.microphoneRawFrameCount >= diagnostics.microphoneResamplerInputFrameCount
        && diagnostics.microphoneEncodedChunkCount >= diagnostics.microphoneForwardedChunkCount,
      microphoneAccountingNote: `Raw capture callbacks are not expected to equal transmitted chunks. Input frames can be discarded before encoding, and multiple resampled frames can combine into one 20 ms encoded PCM chunk. Classified raw/encoded activity is currently ${classifiedRawFrames}; pending bytes are counted separately.`
    });
  }, [publishDiagnostics]);

  const publishPresentationDiagnostics = useCallback((runtimeState: LiveRuntimeState = stateRef.current) => {
    const diagnostics = { ...diagnosticsRef.current, cooldownActive: cooldownActiveRef.current };
    const presentation = liveVoicePresentationForState(runtimeState, diagnostics);
    publishDiagnostics({
      authoritativeVoiceState: `${runtimeState.status}:${runtimeState.turnState}:${runtimeState.outputState}`,
      userVisibleStatusKey: presentation.statusKey,
      userVisibleBadgeLabelKey: presentation.badgeLabelKey,
      microphoneForwardingAllowed: presentation.microphoneForwardingAllowed,
      microphoneIndicatorState: presentation.microphoneIndicator,
      cooldownActive: diagnostics.cooldownActive,
      statusInvariantPassed: presentation.statusInvariantPassed
    });
    setVoicePresentation(presentation);
    return presentation;
  }, [publishDiagnostics]);

  useEffect(() => {
    publishPresentationDiagnostics(state);
  }, [publishPresentationDiagnostics, state]);

  const setPhase = useCallback((phase: Exclude<LiveIntroPhase, "idle">) => {
    publishDiagnostics({ phase });
    setIntroductionState(phaseToIntroductionState(phase));
    dispatch({ type: "intro_phase", phase });
  }, [publishDiagnostics]);

  const fail = useCallback((boundary: LiveIntroFailureBoundary, closeReason: LiveIntroClientCloseReason = "unknown") => {
    if (failedRef.current) return;
    failedRef.current = true;
    if (firstAudioTimerRef.current) clearTimeout(firstAudioTimerRef.current);
    if (setupTimerRef.current) clearTimeout(setupTimerRef.current);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    if (microphoneResponseTimerRef.current) clearTimeout(microphoneResponseTimerRef.current);
    if (productSessionTimerRef.current) clearTimeout(productSessionTimerRef.current);
    cooldownTimerRef.current = undefined;
    microphoneResponseTimerRef.current = undefined;
    productSessionTimerRef.current = undefined;
    cooldownActiveRef.current = false;
    actionRunningRef.current = false;
    permissionPendingRef.current = false;
    pendingToolRef.current = undefined;
    const stats = playerRef.current?.getStats();
    publishDiagnostics({
      failureBoundary: boundary,
      closeReasonCategory: "error",
      currentOutputSegmentStatus: diagnosticsRef.current.currentOutputSegmentId ? "failed" : diagnosticsRef.current.currentOutputSegmentStatus,
      ...(stats ? playerDiagnostics(stats) : {})
    });
    playerWatchdogGenerationRef.current += 1;
    microphoneCaptureRef.current?.stop();
    microphoneCaptureRef.current = undefined;
    microphoneEncoderRef.current.clear();
    playerRef.current?.stop();
    clientRef.current?.close(closeReason);
    setIntroductionState("failed_text_available");
    dispatch({ type: "error", code: "connection_failed", message: safeErrorMessage(boundary) });
  }, [playerDiagnostics, publishDiagnostics]);

  const syncPlayerStats = useCallback(() => {
    const stats = playerRef.current?.getStats();
    if (!stats) return;
    publishDiagnostics(playerDiagnostics(stats));
    publishPresentationDiagnostics();
  }, [playerDiagnostics, publishDiagnostics, publishPresentationDiagnostics]);

  const publishMicrophoneGate = useCallback((voiceState: LiveMicrophoneVoiceState, blockReason: LiveMicrophoneBlockReason) => {
    microphoneVoiceStateRef.current = voiceState;
    microphoneForwardingBlockedRef.current = blockReason !== "none";
    microphoneBlockReasonRef.current = blockReason;
    publishDiagnostics({
      microphoneForwardingBlocked: blockReason !== "none",
      microphoneBlockReason: blockReason,
      microphoneMuted: microphoneMutedRef.current
    });
    if (voiceState === "listening") dispatch({ type: "listen" });
    else if (voiceState === "blocked_during_model_generation") dispatch({ type: "think" });
    else if (voiceState === "blocked_during_playback") dispatch({ type: "speak" });
    else if (voiceState === "blocked_during_cooldown") dispatch({ type: "turn_state", turnState: "post_playback_cooldown" });
  }, [publishDiagnostics]);

  const clearMicrophoneBuffers = useCallback(() => {
    microphoneEncoderRef.current.clear();
  }, []);

  const cancelCooldown = useCallback(() => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = undefined;
    cooldownActiveRef.current = false;
    outputGateRef.current.cancelCooldown();
  }, []);

  const cancelMicrophoneResponseTimeout = useCallback(() => {
    if (microphoneResponseTimerRef.current) clearTimeout(microphoneResponseTimerRef.current);
    if (productSessionTimerRef.current) clearTimeout(productSessionTimerRef.current);
    microphoneResponseTimerRef.current = undefined;
    productSessionTimerRef.current = undefined;
  }, []);

  const startOutputTurn = useCallback((turnId: number, segmentKind: NonNullable<LiveIntroDiagnostics["currentOutputSegmentKind"]> = turnId === 1 ? "introduction" : "normal_response") => {
    playerWatchdogGenerationRef.current += 1;
    outputTurnIdRef.current = turnId;
    outputGateRef.current.startOutputTurn(turnId);
    generationCompleteRef.current = false;
    turnCompleteRef.current = false;
    drainingRef.current = false;
    modelOutputActiveRef.current = true;
    playbackActiveRef.current = true;
    responseAudioPartCountRef.current = 0;
    const snapshot = outputGateRef.current.snapshot();
    const stats = playerRef.current?.getStats();
    outputSegmentBaselineRef.current = {
      audioPartCount: diagnosticsRef.current.audioPartCount,
      decodedSampleCount: stats?.decodedSampleCount ?? diagnosticsRef.current.decodedSampleCount,
      scheduledSourceCount: stats?.scheduledSourceCount ?? diagnosticsRef.current.scheduledSourceCount,
      endedSourceCount: stats?.endedSourceCount ?? diagnosticsRef.current.endedSourceCount
    };
    publishDiagnostics({
      outputTurnId: snapshot.outputTurnId,
      currentConnectionGeneration: connectionGenerationRef.current,
      currentInteractionId: segmentKind === "introduction" ? 0 : userTurnIdRef.current,
      currentInteractionKind: segmentKind === "introduction" ? "introduction" : segmentKind === "tool_continuation" || segmentKind === "permission_acknowledgement" ? "tool_action" : "microphone_turn",
      currentOutputSegmentId: snapshot.outputTurnId,
      currentOutputSegmentKind: segmentKind,
      currentOutputSegmentStatus: "waiting_for_audio",
      playerWatchdogGeneration: playerWatchdogGenerationRef.current,
      playerWatchdogSegmentId: snapshot.outputTurnId,
      generationCompleteReceivedForCurrentSegment: false,
      turnCompleteReceivedForCurrentSegment: false,
      playerDrainedForCurrentSegment: false,
      currentSegmentAudioChunkCount: 0,
      currentSegmentDecodedSampleCount: 0,
      currentSegmentScheduledSourceCount: 0,
      currentSegmentEndedSourceCount: 0,
      currentSegmentActiveSourceCount: stats?.activeOutputSourceCount ?? 0,
      pendingToolCallCount: pendingToolRef.current ? 1 : 0,
      awaitingToolResponse: Boolean(pendingToolRef.current || actionRunningRef.current || permissionPendingRef.current),
      serverTurnCompleteReceivedForOutputTurn: snapshot.serverTurnCompleteReceivedForOutputTurn,
      playerDrainedForOutputTurn: snapshot.playerDrainedForOutputTurn
    });
    publishPresentationDiagnostics();
  }, [publishDiagnostics, publishPresentationDiagnostics]);

  const ensureOutputTurn = useCallback(() => {
    if (!modelOutputActiveRef.current) startOutputTurn(outputTurnIdRef.current + 1);
  }, [startOutputTurn]);

  const completePhase1COneTurn = useCallback(() => {
    completedOneTurnRef.current = true;
    modelOutputActiveRef.current = false;
    playbackActiveRef.current = false;
    cooldownActiveRef.current = false;
    stoppedRef.current = true;
    microphoneCaptureRef.current?.stop();
    microphoneCaptureRef.current = undefined;
    clearMicrophoneBuffers();
    clientRef.current?.close("session_complete");
    publishMicrophoneGate("stopped", "completed_one_turn");
    publishDiagnostics({ phase: "completed_one_turn", completedOneTurn: true, cooldownActive: false });
    dispatch({ type: "intro_phase", phase: "completed_one_turn" });
    setIntroductionState("delivered");
    publishPresentationDiagnostics({ ...stateRef.current, status: "completed_one_turn", turnState: "disconnected", outputState: "idle" });
  }, [clearMicrophoneBuffers, publishDiagnostics, publishMicrophoneGate, publishPresentationDiagnostics]);

  const startListeningAfterCooldown = useCallback((turnId: number) => {
    const snapshot = outputGateRef.current.snapshot();
    if (turnId !== snapshot.outputTurnId || stoppedRef.current || failedRef.current) return;
    if (!snapshot.serverTurnCompleteReceivedForOutputTurn) {
      fail("listening_started_before_server_turn_complete");
      return;
    }
    if (!snapshot.playerDrainedForOutputTurn) {
      fail("listening_started_before_player_drain");
      return;
    }
    if (!diagnosticsRef.current.cooldownCompletedAt) {
      fail("listening_started_before_cooldown_complete");
      return;
    }
    clearMicrophoneBuffers();
    userTurnIdRef.current += 1;
    microphoneTurnStartedRef.current = false;
    modelResponseAfterMicrophoneStartedRef.current = false;
    responseAudioPartCountRef.current = 0;
    modelOutputActiveRef.current = false;
    playbackActiveRef.current = false;
    actionRunningRef.current = false;
    permissionPendingRef.current = false;
    publishDiagnostics({ microphoneListeningStartedAt: Date.now(), cooldownActive: false });
    publishMicrophoneGate("listening", "none");
    publishPresentationDiagnostics({ ...stateRef.current, status: "listening", turnState: "listening" });
  }, [clearMicrophoneBuffers, fail, publishDiagnostics, publishMicrophoneGate, publishPresentationDiagnostics]);

  const maybeStartOutputCooldown = useCallback((turnId: number) => {
    if (!outputGateRef.current.startCooldown(turnId)) return;
    cooldownActiveRef.current = true;
    const now = Date.now();
    publishDiagnostics({
      cooldownStartedAt: now,
      cooldownActive: true,
      outputTurnId: turnId,
      serverTurnCompleteReceivedForOutputTurn: true,
      playerDrainedForOutputTurn: true,
      playerDrainedForCurrentSegment: true,
      currentOutputSegmentStatus: "completed"
    });
    publishMicrophoneGate("blocked_during_cooldown", "cooldown_active");
    cooldownTimerRef.current = setTimeout(() => {
      if (stoppedRef.current || failedRef.current || outputTurnIdRef.current !== turnId) return;
      cooldownTimerRef.current = undefined;
      cooldownActiveRef.current = false;
      publishDiagnostics({ cooldownCompletedAt: Date.now(), cooldownActive: false });
      if (conversationModeRef.current === "single_turn_diagnostic" && turnId > 1) completePhase1COneTurn();
      else if (!completedOneTurnRef.current) startListeningAfterCooldown(turnId);
    }, phase1CCooldownMs());
  }, [completePhase1COneTurn, publishDiagnostics, publishMicrophoneGate, startListeningAfterCooldown]);

  const markServerTurnCompleteForCurrentOutput = useCallback((now: number) => {
    const turnId = outputTurnIdRef.current;
    const canStartCooldown = outputGateRef.current.markServerTurnComplete(turnId);
    publishDiagnostics({ turnCompleteAt: now, serverTurnCompleteReceivedForOutputTurn: true, turnCompleteReceivedForCurrentSegment: true, currentOutputSegmentStatus: "waiting_for_turn_complete", outputTurnId: turnId });
    if (canStartCooldown) maybeStartOutputCooldown(turnId);
  }, [maybeStartOutputCooldown, publishDiagnostics]);

  const processMicrophoneFrame = useCallback((frame: { frame: Float32Array; inputSampleRate: number; channelCount: number }) => {
    if (failedRef.current) return;
    const capturedCount = diagnosticsRef.current.microphoneCapturedChunkCount + 1;
    publishDiagnostics({
      microphoneCapturedChunkCount: capturedCount,
      microphoneRawFrameCount: diagnosticsRef.current.microphoneRawFrameCount + 1,
      microphoneRawSampleCount: diagnosticsRef.current.microphoneRawSampleCount + frame.frame.length,
      microphoneInputSampleRate: frame.inputSampleRate,
      microphoneTransmittedSampleRate: LIVE_INPUT_SAMPLE_RATE,
      microphoneChannelCount: frame.channelCount
    });
    const decision = canForwardPhase1CMicrophonePcm({
      voiceState: microphoneVoiceStateRef.current,
      microphonePermissionGranted: microphonePermissionGrantedRef.current,
      microphoneEnabled: microphoneEnabledRef.current,
      muted: microphoneMutedRef.current,
      stopped: stoppedRef.current,
      modelOutputActive: modelOutputActiveRef.current,
      playbackActive: playbackActiveRef.current,
      cooldownActive: cooldownActiveRef.current,
      completedOneTurn: completedOneTurnRef.current,
      permissionPending: permissionPendingRef.current,
      actionRunning: actionRunningRef.current
    });
    if (!decision.allowed) {
      clearMicrophoneBuffers();
      const update: Partial<LiveIntroDiagnostics> = {
        microphoneDiscardedChunkCount: diagnosticsRef.current.microphoneDiscardedChunkCount + 1,
        microphoneForwardingBlocked: true,
        microphoneBlockReason: decision.reason
      };
      if (decision.reason === "not_listening" || decision.reason === "microphone_disabled") update.microphoneDiscardedBeforeListeningCount = diagnosticsRef.current.microphoneDiscardedBeforeListeningCount + 1;
      else if (decision.reason === "model_output_active" || decision.reason === "playback_active" || decision.reason === "action_running") update.microphoneDiscardedDuringOutputCount = diagnosticsRef.current.microphoneDiscardedDuringOutputCount + 1;
      else if (decision.reason === "cooldown_active") update.microphoneDiscardedDuringCooldownCount = diagnosticsRef.current.microphoneDiscardedDuringCooldownCount + 1;
      else if (decision.reason === "muted") update.microphoneDiscardedMutedCount = diagnosticsRef.current.microphoneDiscardedMutedCount + 1;
      else if (decision.reason === "permission_not_granted" || decision.reason === "permission_pending") update.microphoneDiscardedPermissionCount = diagnosticsRef.current.microphoneDiscardedPermissionCount + 1;
      else if (decision.reason === "stopped" || decision.reason === "completed_one_turn") update.microphoneDiscardedAfterEndCount = diagnosticsRef.current.microphoneDiscardedAfterEndCount + 1;
      publishDiagnostics(update);
      publishMicrophoneAccounting();
      return;
    }
    try {
      publishDiagnostics({ microphoneResamplerInputFrameCount: diagnosticsRef.current.microphoneResamplerInputFrameCount + 1 });
      const chunks = microphoneEncoderRef.current.encode(frame.frame, frame.inputSampleRate);
      publishDiagnostics({
        microphoneResamplerOutputChunkCount: diagnosticsRef.current.microphoneResamplerOutputChunkCount + chunks.length,
        microphoneEncodedChunkCount: diagnosticsRef.current.microphoneEncodedChunkCount + chunks.length,
        microphonePendingChunkCount: microphoneEncoderRef.current.pendingChunkCount,
        microphonePendingByteCount: microphoneEncoderRef.current.pendingByteCount
      });
      if (!chunks.length) return;
      if (!microphoneTurnStartedRef.current) {
        microphoneTurnStartedRef.current = true;
        publishDiagnostics({ userTurnStartDetected: true });
        microphoneResponseTimerRef.current = setTimeout(() => {
          if (!modelResponseAfterMicrophoneStartedRef.current && !failedRef.current && !stoppedRef.current) fail("no_model_response_after_microphone");
        }, MICROPHONE_RESPONSE_TIMEOUT_MS);
      }
      for (const chunk of chunks) {
        try {
          clientRef.current?.sendAudio(chunk.data, chunk.sampleRate);
        } catch {
          publishDiagnostics({ microphoneSendFailureCount: diagnosticsRef.current.microphoneSendFailureCount + 1 });
          publishMicrophoneAccounting();
          fail("microphone_chunk_send_failed");
          return;
        }
        publishDiagnostics({
          microphoneForwardedChunkCount: diagnosticsRef.current.microphoneForwardedChunkCount + 1,
          microphoneForwardedByteCount: diagnosticsRef.current.microphoneForwardedByteCount + chunk.byteLength,
          latestMicrophoneForwardAt: Date.now(),
          microphoneTransmittedSampleRate: chunk.sampleRate
        });
        publishMicrophoneAccounting();
      }
    } catch (error) {
      publishDiagnostics({ microphoneEncodeFailureCount: diagnosticsRef.current.microphoneEncodeFailureCount + 1 });
      publishMicrophoneAccounting();
      const message = error instanceof Error ? error.message : "";
      if (message.includes("sample_rate")) fail("microphone_sample_rate_invalid");
      else if (message.includes("resample")) fail("microphone_resample_failed");
      else fail("microphone_pcm_encode_failed");
    }
  }, [clearMicrophoneBuffers, fail, publishDiagnostics, publishMicrophoneAccounting]);

  const beginModelResponseAfterMicrophone = useCallback((now: number) => {
    if (!microphoneTurnStartedRef.current || modelResponseAfterMicrophoneStartedRef.current) return;
    modelResponseAfterMicrophoneStartedRef.current = true;
    cancelMicrophoneResponseTimeout();
    publishDiagnostics({
      userTurnEndDetected: true,
      userTurnClosedAt: now,
      firstResponseAfterMicrophoneAt: now,
      modelResponseCountAfterMicrophone: diagnosticsRef.current.modelResponseCountAfterMicrophone + 1,
      microphoneListeningStoppedAt: now
    });
    clearMicrophoneBuffers();
    publishMicrophoneGate("blocked_during_model_generation", "model_output_active");
    try {
      clientRef.current?.endAudio();
    } catch {
      // A late audio-stream-end failure should not expose provider details.
    }
    startOutputTurn(outputTurnIdRef.current + 1, "normal_response");
  }, [cancelMicrophoneResponseTimeout, clearMicrophoneBuffers, publishDiagnostics, publishMicrophoneGate, startOutputTurn]);

  const sendToolOutcome = useCallback((call: LiveToolCall, response: Record<string, unknown>) => {
    clearMicrophoneBuffers();
    publishMicrophoneGate("blocked_during_model_generation", "model_output_active");
    modelOutputActiveRef.current = true;
    actionRunningRef.current = false;
    permissionPendingRef.current = false;
    startOutputTurn(outputTurnIdRef.current + 1, "tool_continuation");
    publishDiagnostics({ pendingToolCallCount: 0, awaitingToolResponse: false });
    clientRef.current?.sendToolResponse(call, response);
  }, [clearMicrophoneBuffers, publishDiagnostics, publishMicrophoneGate, startOutputTurn]);

  const executeValidatedTool = useCallback(async (call: LiveToolCall, action: AgentAction, ledgerKey: string) => {
    const entry = toolLedgerRef.current.get(ledgerKey);
    if (entry?.status === "completed" || entry?.status === "responded" || entry?.status === "executing") return;
    toolLedgerRef.current.set(ledgerKey, { status: "executing" });
    actionRunningRef.current = true;
    permissionPendingRef.current = false;
    publishDiagnostics({ pendingToolCallCount: 1, awaitingToolResponse: true });
    dispatch({ type: "action_running" });
    try {
      const message = await executeRef.current(action);
      toolLedgerRef.current.set(ledgerKey, { status: "completed", response: message });
      sendToolOutcome(call, { status: "completed", message });
      toolLedgerRef.current.set(ledgerKey, { status: "responded", response: message });
    } catch {
      const message = "Sema could not complete that app action. Text interaction remains available.";
      toolLedgerRef.current.set(ledgerKey, { status: "failed", response: message });
      sendToolOutcome(call, { status: "failed", message });
      toolLedgerRef.current.set(ledgerKey, { status: "responded", response: message });
    }
  }, [publishDiagnostics, sendToolOutcome]);

  const handleToolCalls = useCallback((calls: LiveToolCall[]) => {
    for (const call of calls) {
      const ledgerKey = toolLedgerKey(call);
      const existing = toolLedgerRef.current.get(ledgerKey);
      if (existing?.status === "completed" || existing?.status === "responded" || existing?.status === "executing" || existing?.status === "awaiting_permission") {
        if (existing.response && existing.status === "responded") sendToolOutcome(call, { status: "duplicate_ignored", message: existing.response });
        continue;
      }
      toolLedgerRef.current.set(ledgerKey, { status: "received" });
      const validation = validateLiveToolCall(call, sessionRef.current);
      if (!validation.ok) {
        toolLedgerRef.current.set(ledgerKey, { status: "failed", response: validation.message });
        sendToolOutcome(call, { status: "failed", message: validation.message });
        toolLedgerRef.current.set(ledgerKey, { status: "responded", response: validation.message });
        continue;
      }
      const safety = screenLiveInput(`${call.name} ${JSON.stringify(call.args ?? {})}`);
      if (!safety.safe) {
        onSafetyFlags(safety.flags);
        const message = "That request crosses Sema's safety boundary. Sema can help organize what you noticed instead.";
        toolLedgerRef.current.set(ledgerKey, { status: "failed", response: message });
        sendToolOutcome(call, { status: "failed", message });
        toolLedgerRef.current.set(ledgerKey, { status: "responded", response: message });
        continue;
      }
      toolLedgerRef.current.set(ledgerKey, { status: "validated" });
      if (validation.permissionRequired) {
        clearMicrophoneBuffers();
        permissionPendingRef.current = true;
        actionRunningRef.current = false;
        publishDiagnostics({ pendingToolCallCount: 1, awaitingToolResponse: true });
        publishMicrophoneGate("ready_but_blocked", "permission_pending");
        pendingToolRef.current = { call, action: validation.action, ledgerKey };
        toolLedgerRef.current.set(ledgerKey, { status: "awaiting_permission" });
        dispatch({ type: "permission", pending: { call, action: validation.action } });
        continue;
      }
      void executeValidatedTool(call, validation.action, ledgerKey);
    }
  }, [clearMicrophoneBuffers, executeValidatedTool, onSafetyFlags, publishDiagnostics, publishMicrophoneGate, sendToolOutcome, toolLedgerKey]);

  const completeWhenDrained = useCallback(() => {
    if (failedRef.current || stoppedRef.current || drainingRef.current) return;
    if (!generationCompleteRef.current && !turnCompleteRef.current) return;
    if (!diagnosticsRef.current.audioPartCount) return;
    drainingRef.current = true;
    const drainingTurnId = outputTurnIdRef.current;
    const drainingConnectionGeneration = connectionGenerationRef.current;
    const drainingInteractionId = diagnosticsRef.current.currentInteractionId;
    const drainingWatchdogGeneration = playerWatchdogGenerationRef.current + 1;
    playerWatchdogGenerationRef.current = drainingWatchdogGeneration;
    const segmentKind = diagnosticsRef.current.currentOutputSegmentKind;
    const armedAt = Date.now();
    const armedStats = playerRef.current?.getStats();
    const isCurrentDrainWatchdog = () => (
      !failedRef.current
      && !stoppedRef.current
      && drainingTurnId === outputTurnIdRef.current
      && drainingConnectionGeneration === connectionGenerationRef.current
      && drainingInteractionId === diagnosticsRef.current.currentInteractionId
      && drainingWatchdogGeneration === playerWatchdogGenerationRef.current
      && diagnosticsRef.current.currentOutputSegmentId === drainingTurnId
    );
    setIntroductionState("draining");
    if (armedStats) {
      publishDiagnostics({
        ...playerDiagnostics(armedStats),
        currentOutputSegmentStatus: "draining",
        playerWatchdogType: "player_progress",
        playerWatchdogArmedAt: armedAt,
        playerWatchdogExpectedRemainingMsAtArm: armedStats.expectedRemainingPlaybackMs,
        playerWatchdogDeadlineAt: armedAt + armedStats.expectedRemainingPlaybackMs + LIVE_PLAYER_DRAIN_GRACE_MS,
        playerWatchdogGeneration: drainingWatchdogGeneration,
        playerWatchdogSegmentId: drainingTurnId,
        playbackProgressObserved: (armedStats.sourceEndProgressCount ?? 0) > 0
      });
    }
    void playerRef.current?.waitForDrain({ graceMs: LIVE_PLAYER_DRAIN_GRACE_MS }).then((stats) => {
      if (!isCurrentDrainWatchdog()) return;
      drainingRef.current = false;
      playbackActiveRef.current = false;
      const canStartCooldown = outputGateRef.current.markPlayerDrained(drainingTurnId);
      publishDiagnostics({
        ...(segmentKind === "introduction" ? { phase: "intro_drained" as const } : {}),
        playbackDrainedAt: Date.now(),
        playerDrainedForOutputTurn: true,
        playerDrainedForCurrentSegment: true,
        currentOutputSegmentStatus: "drained",
        outputTurnId: drainingTurnId,
        ...playerDiagnostics(stats),
        playerWatchdogGeneration: drainingWatchdogGeneration,
        playerWatchdogSegmentId: drainingTurnId,
        playbackProgressObserved: true
      });
      if (segmentKind === "introduction") dispatch({ type: "intro_phase", phase: "intro_drained" });
      else dispatch({ type: "output_state", outputState: "complete" });
      if (canStartCooldown) maybeStartOutputCooldown(drainingTurnId);
    }).catch((error) => {
      if (!isCurrentDrainWatchdog()) return;
      drainingRef.current = false;
      const boundary = error instanceof LivePcmOutputError ? error.boundary : "player_failed_to_drain";
      publishDiagnostics({
        currentOutputSegmentStatus: "failed",
        failureBoundary: boundary,
        truePlayerStallCount: diagnosticsRef.current.truePlayerStallCount + 1,
        playerWatchdogGeneration: drainingWatchdogGeneration,
        playerWatchdogSegmentId: drainingTurnId,
        ...(playerRef.current ? playerDiagnostics(playerRef.current.getStats()) : {})
      });
      fail(boundary);
    });
  }, [fail, maybeStartOutputCooldown, playerDiagnostics, publishDiagnostics]);

  const handleIntroEvents = useCallback((events: LiveIntroParsedEvent[], metadata: LiveIntroInboundMessageMetadata) => {
    if (failedRef.current || stoppedRef.current) return;
    const now = Date.now();
    const firstServerMessageAt = diagnosticsRef.current.firstServerMessageAt ?? now;
    const firstFrameUpdate: Partial<LiveIntroDiagnostics> = diagnosticsRef.current.firstServerMessageAt ? {} : {
      firstServerFrameType: metadata.frameType,
      firstServerFrameByteLength: metadata.byteLength,
      firstServerFrameNormalizationSucceeded: metadata.normalizationSucceeded,
      firstServerFrameJsonParseSucceeded: metadata.jsonParseSucceeded,
      firstServerJsonRootType: metadata.jsonRootType,
      firstServerMessageTopLevelKeys: metadata.topLevelKeys,
      firstServerMessageTopLevelKeyCount: metadata.topLevelKeyCount,
      firstServerMessageCanonicalKind: metadata.canonicalKind,
      setupCompletePropertyPresent: metadata.setupCompletePropertyPresent,
      firstServerProviderErrorCode: metadata.providerErrorCode,
      firstServerProviderErrorStatus: metadata.providerErrorStatus,
      firstServerProviderErrorCategory: metadata.providerErrorCategory
    };
    publishDiagnostics({
      serverMessageCount: diagnosticsRef.current.serverMessageCount + 1,
      firstServerMessageAt,
      latestServerMessageAt: now,
      ...firstFrameUpdate
    });
    for (const event of events) {
      switch (event.type) {
        case "setup_complete":
          publishDiagnostics({ setupCompleteAt: now });
          setupResolverRef.current?.();
          setupResolverRef.current = undefined;
          setupRejecterRef.current = undefined;
          if (setupTimerRef.current) clearTimeout(setupTimerRef.current);
          break;
        case "audio":
          if (microphoneTurnStartedRef.current) beginModelResponseAfterMicrophone(now);
          else ensureOutputTurn();
          if (firstAudioTimerRef.current) clearTimeout(firstAudioTimerRef.current);
          playbackActiveRef.current = true;
          if (microphoneTurnStartedRef.current || actionRunningRef.current || permissionPendingRef.current) responseAudioPartCountRef.current += 1;
          if (microphoneTurnStartedRef.current) publishMicrophoneGate("blocked_during_playback", "playback_active");
          publishDiagnostics({
            audioPartCount: diagnosticsRef.current.audioPartCount + 1,
            firstAudioAt: diagnosticsRef.current.firstAudioAt ?? now,
            latestAudioPartAt: now,
            modelContentMessageCount: diagnosticsRef.current.modelContentMessageCount + 1
          });
          try {
            const stats = playerRef.current?.enqueueBase64Pcm(event.data);
            if (!stats) throw new LivePcmOutputError("decoded_audio_not_buffered", "Audio player is unavailable.");
            publishDiagnostics({
              ...(diagnosticsRef.current.currentOutputSegmentKind === "introduction" ? { phase: "intro_playing" as const } : {}),
              currentOutputSegmentStatus: "playing",
              ...playerDiagnostics(stats)
            });
            if (diagnosticsRef.current.currentOutputSegmentKind === "introduction") dispatch({ type: "intro_phase", phase: "intro_playing" });
            else dispatch({ type: "speak" });
            setIntroductionState("speaking");
          } catch (error) {
            fail(error instanceof LivePcmOutputError ? error.boundary : "pcm_decode_failed");
          }
          break;
        case "audio_missing_data":
          publishDiagnostics({ audioPartsWithoutData: diagnosticsRef.current.audioPartsWithoutData + 1 });
          fail("audio_parts_without_data");
          break;
        case "unsupported_audio_mime":
          publishDiagnostics({ unsupportedAudioMimeCount: diagnosticsRef.current.unsupportedAudioMimeCount + 1 });
          fail("unsupported_audio_mime");
          break;
        case "output_transcript":
        case "output_text":
          if (microphoneTurnStartedRef.current) beginModelResponseAfterMicrophone(now);
          else ensureOutputTurn();
          publishDiagnostics({
            outputTextPartCount: diagnosticsRef.current.outputTextPartCount + 1,
            modelContentMessageCount: diagnosticsRef.current.modelContentMessageCount + 1
          });
          break;
        case "generation_complete":
          generationCompleteRef.current = true;
          publishDiagnostics({ generationCompleteAt: now, generationCompleteReceivedForCurrentSegment: true, currentOutputSegmentStatus: "generation_complete" });
          completeWhenDrained();
          break;
        case "turn_complete":
          turnCompleteRef.current = true;
          markServerTurnCompleteForCurrentOutput(now);
          if ((microphoneTurnStartedRef.current || actionRunningRef.current || permissionPendingRef.current) && modelResponseAfterMicrophoneStartedRef.current && responseAudioPartCountRef.current === 0) fail("response_transcript_without_audio");
          completeWhenDrained();
          break;
        case "interrupted":
          publishDiagnostics({ interruptedCount: diagnosticsRef.current.interruptedCount + 1 });
          fail("server_interrupted_intro");
          break;
        case "tool_call":
          publishDiagnostics({
            toolCallCount: diagnosticsRef.current.toolCallCount + 1,
            pendingToolCallCount: event.calls.length,
            awaitingToolResponse: event.calls.length > 0
          });
          handleToolCalls(event.calls);
          break;
        case "go_away":
          publishDiagnostics({ goAwayCount: diagnosticsRef.current.goAwayCount + 1, goAwayReceived: true });
          break;
        case "session_resumption_update":
          publishDiagnostics({ sessionResumptionUpdateCount: diagnosticsRef.current.sessionResumptionUpdateCount + 1 });
          break;
        case "server_content_without_model_content":
          publishDiagnostics({ modelContentMessageCount: diagnosticsRef.current.modelContentMessageCount });
          break;
        case "provider_error":
          publishDiagnostics({ providerErrorCount: diagnosticsRef.current.providerErrorCount + 1 });
          fail(diagnosticsRef.current.phase === "setup_waiting" || diagnosticsRef.current.phase === "setup_sending" ? "setup_rejected" : "server_response_without_model_content");
          break;
        case "unrecognized_server_message":
          publishDiagnostics({ unrecognizedServerMessageCount: diagnosticsRef.current.unrecognizedServerMessageCount + 1 });
          if (diagnosticsRef.current.phase === "setup_waiting" || diagnosticsRef.current.phase === "setup_sending") fail("setup_not_completed");
          break;
        case "parse_error":
          fail(event.boundary);
          break;
      }
    }
  }, [beginModelResponseAfterMicrophone, completeWhenDrained, ensureOutputTurn, fail, handleToolCalls, markServerTurnCompleteForCurrentOutput, playerDiagnostics, publishDiagnostics, publishMicrophoneGate]);

  const cleanup = useCallback((closeReason: LiveIntroClientCloseReason = "component_cleanup") => {
    stoppedRef.current = true;
    playerWatchdogGenerationRef.current += 1;
    if (firstAudioTimerRef.current) clearTimeout(firstAudioTimerRef.current);
    if (setupTimerRef.current) clearTimeout(setupTimerRef.current);
    cancelCooldown();
    cancelMicrophoneResponseTimeout();
    firstAudioTimerRef.current = undefined;
    setupTimerRef.current = undefined;
    setupResolverRef.current = undefined;
    setupRejecterRef.current = undefined;
    microphoneCaptureRef.current?.stop();
    microphoneCaptureRef.current = undefined;
    clearMicrophoneBuffers();
    microphoneVoiceStateRef.current = "stopped";
    microphoneEnabledRef.current = false;
    microphoneForwardingBlockedRef.current = true;
    microphoneBlockReasonRef.current = "stopped";
    actionRunningRef.current = false;
    permissionPendingRef.current = false;
    pendingToolRef.current = undefined;
    toolLedgerRef.current.clear();
    clientRef.current?.close(closeReason);
    playerRef.current?.close();
    clientRef.current = undefined;
    playerRef.current = undefined;
  }, [cancelCooldown, cancelMicrophoneResponseTimeout, clearMicrophoneBuffers]);

  const startIntroOnlySession = useCallback(async () => {
    if (!publicStatus?.available) {
      dispatch({ type: "error", code: "disabled", message: publicStatus?.reason ?? "Sema Live is unavailable. Text interaction is still available." });
      return;
    }
    cleanup("retry_replacement");
    stoppedRef.current = false;
    failedRef.current = false;
    connectionGenerationRef.current += 1;
    toolLedgerRef.current.clear();
    pendingToolRef.current = undefined;
    drainingRef.current = false;
    generationCompleteRef.current = false;
    turnCompleteRef.current = false;
    microphonePermissionGrantedRef.current = false;
    microphoneEnabledRef.current = false;
    microphoneMutedRef.current = false;
    microphoneVoiceStateRef.current = "permission_pending";
    microphoneForwardingBlockedRef.current = true;
    microphoneBlockReasonRef.current = "permission_not_granted";
    modelOutputActiveRef.current = false;
    playbackActiveRef.current = false;
    cooldownActiveRef.current = false;
    completedOneTurnRef.current = false;
    microphoneTurnStartedRef.current = false;
    modelResponseAfterMicrophoneStartedRef.current = false;
    responseAudioPartCountRef.current = 0;
    actionRunningRef.current = false;
    permissionPendingRef.current = false;
    userTurnIdRef.current = 0;
    outputTurnIdRef.current = 0;
    playerWatchdogGenerationRef.current = 0;
    outputSegmentBaselineRef.current = { audioPartCount: 0, decodedSampleCount: 0, scheduledSourceCount: 0, endedSourceCount: 0 };
    outputGateRef.current = new LiveOutputTurnGate();
    microphoneEncoderRef.current = new LiveMicrophonePcmEncoder();
    diagnosticsRef.current = createLiveIntroDiagnostics();
    const liveSessionStartedAt = Date.now();
    const configuredProductSessionLimitMs = (publicStatus.maxSessionMinutes || 10) * 60_000;
    publishDiagnostics({
      phase: "player_preparing",
      startedAt: liveSessionStartedAt,
      liveSessionStartedAt,
      configuredProductSessionLimitMs,
      productSessionLimitReached: false,
      connectionGeneration: connectionGenerationRef.current,
      audioContextInitStartedAt: Date.now()
    });
    productSessionTimerRef.current = setTimeout(() => {
      if (stoppedRef.current || failedRef.current) return;
      publishDiagnostics({
        productSessionLimitReached: true,
        closeReasonCategory: "product_session_limit",
        currentVoiceState: stateRef.current.status,
        noResponseWatchdogType: undefined
      });
      cleanup("session_complete");
      dispatch({ type: "session_complete", message: "This Live voice session reached Sema's configured time limit. Your saved session information is still available, and text interaction remains available." });
      setIntroductionState("delivered");
    }, configuredProductSessionLimitMs);
    setPhase("player_preparing");
    try {
      playerRef.current = new LivePcmOutputPlayer();
      const playerStats = await playerRef.current.init();
      publishDiagnostics({
        audioContextReadyAt: Date.now(),
        actualOutputSampleRate: playerStats.actualSampleRate,
        audioContextState: playerStats.audioContextState
      });
      if (playerStats.audioContextState !== "running") throw new LivePcmOutputError("scheduled_source_not_started", "AudioContext did not start running.");

      dispatch({ type: "request_microphone" });
      publishDiagnostics({ microphonePermissionRequested: true, microphoneForwardingBlocked: true, microphoneBlockReason: "permission_not_granted" });
      microphoneCaptureRef.current = new LiveMicrophoneCapture(processMicrophoneFrame);
      const microphoneStats = await microphoneCaptureRef.current.start();
      microphonePermissionGrantedRef.current = true;
      microphoneEnabledRef.current = true;
      publishDiagnostics({
        microphonePermissionGranted: true,
        microphoneStreamCreated: true,
        microphoneCaptureStartedAt: Date.now(),
        microphoneInputSampleRate: microphoneStats.inputSampleRate,
        microphoneTransmittedSampleRate: LIVE_INPUT_SAMPLE_RATE,
        microphoneChannelCount: microphoneStats.channelCount,
        microphoneForwardingBlocked: true,
        microphoneBlockReason: "not_listening"
      });
      publishMicrophoneGate("ready_but_blocked", "not_listening");

      setPhase("token_requesting");
      publishDiagnostics({ credentialRequestedAt: Date.now() });
      const nonce = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const response = await fetch("/api/ai/live/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce }) });
      const tokenBody = await response.json() as unknown;
      if (!response.ok) throw new Error("token request failed");
      const token = sanitizeTokenResponse(tokenBody);
      if (!token) throw new Error("token response invalid");
      publishDiagnostics({ credentialReceivedAt: Date.now() });

      setPhase("socket_connecting");
      publishDiagnostics({ socketOpeningAt: Date.now() });
      clientRef.current = new GeminiLiveIntroClient({
        onOpen: () => publishDiagnostics({ socketOpenAt: Date.now(), connectionOpenedAt: Date.now(), socketReadyState: "open", connectionGeneration: connectionGenerationRef.current }),
        onMessage: handleIntroEvents,
        onClose: (event, closeMetadata) => {
          const duringActiveTurn = diagnosticsRef.current.phase !== "completed_one_turn" && !stoppedRef.current && !failedRef.current;
          publishDiagnostics({
            socketClosedDuringIntro: duringActiveTurn,
            lastSocketCloseCode: event.code,
            closeInitiator: closeMetadata.closeInitiator,
            clientCloseReasonCategory: closeMetadata.clientCloseReasonCategory,
            closeReasonCategory: closeMetadata.clientCloseReasonCategory === "session_complete" ? "product_session_limit" : closeMetadata.closeInitiator === "client" ? "intentional" : "provider",
            clientCloseRequestedAt: closeMetadata.clientCloseRequestedAt,
            providerCloseObservedAt: closeMetadata.providerCloseObservedAt
          });
          if (duringActiveTurn) fail(microphoneTurnStartedRef.current ? "socket_closed_during_microphone_turn" : diagnosticsRef.current.socketOpenAt ? "socket_closed_during_intro" : "websocket_closed_before_open");
        },
        onError: () => {
          if (!diagnosticsRef.current.socketOpenAt) fail("websocket_connect_failed");
        }
      });
      await clientRef.current.connect(token.token);

      const waitForSetupComplete = new Promise<void>((resolve, reject) => {
        setupResolverRef.current = resolve;
        setupRejecterRef.current = reject;
        setupTimerRef.current = setTimeout(() => reject("setup_not_completed"), SETUP_TIMEOUT_MS);
      });
      setPhase("setup_sending");
      try {
        clientRef.current.sendSetup(buildGeminiLiveIntroSetup({ model: token.model, voiceName: token.voiceName, thinkingLevel: token.thinkingLevel }));
        publishDiagnostics({ setupSentAt: Date.now(), setupSendCount: diagnosticsRef.current.setupSendCount + 1 });
      } catch {
        fail("setup_send_failed");
        return;
      }

      setPhase("setup_waiting");
      await waitForSetupComplete.catch((boundary) => {
        fail(
          boundary === "setup_not_completed" ? "setup_not_completed" : "setup_rejected",
          boundary === "setup_not_completed" ? "setup_timeout" : "unknown"
        );
        throw new Error("setup failed");
      });
      if (failedRef.current || stoppedRef.current) return;

      setPhase("intro_requesting");
      if (diagnosticsRef.current.introSendCount > 0) {
        fail("duplicate_intro_attempt");
        return;
      }
      try {
        startOutputTurn(1);
        clientRef.current.sendIntro(LIVE_INTRODUCTION);
        publishDiagnostics({ introSentAt: Date.now(), introSendCount: diagnosticsRef.current.introSendCount + 1 });
      } catch {
        fail("intro_send_failed");
        return;
      }

      setPhase("intro_waiting_for_audio");
      firstAudioTimerRef.current = setTimeout(() => {
        if (diagnosticsRef.current.audioPartCount > 0) return;
        if (diagnosticsRef.current.outputTextPartCount > 0) fail("transcript_without_audio_parts");
        else if (diagnosticsRef.current.serverMessageCount > 0) fail("server_response_without_model_content");
        else fail("no_server_response");
      }, FIRST_AUDIO_TIMEOUT_MS);
    } catch (error) {
      if (failedRef.current) return;
      const message = error instanceof Error ? error.message : "";
      if (error instanceof LivePcmOutputError) fail(error.boundary === "scheduled_source_not_started" ? "audio_context_not_running" : error.boundary);
      else if (message === "microphone_api_unavailable") fail("microphone_api_unavailable");
      else if (message === "microphone_permission_denied") fail("microphone_permission_denied");
      else if (message === "microphone_stream_failed") fail("microphone_stream_failed");
      else if (message === "microphone_processor_failed") fail("microphone_processor_failed");
      else if (message.includes("token response")) fail("token_response_invalid");
      else if (message.includes("token")) fail("token_request_failed");
      else fail("player_init_failed");
    } finally {
      syncPlayerStats();
    }
  }, [cleanup, fail, handleIntroEvents, processMicrophoneFrame, publicStatus, publishDiagnostics, publishMicrophoneGate, setPhase, startOutputTurn, syncPlayerStats]);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/live/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((value: LivePublicStatus) => { if (active) setPublicStatus(value); })
      .catch(() => { if (active) setPublicStatus(publicStatusFallback()); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => cleanup("component_cleanup"), [cleanup]);

  function requestStart() { dispatch({ type: "request_consent" }); }
  function acceptConsent() { dispatch({ type: "consent" }); void startIntroOnlySession(); }
  function declineConsent() { dispatch({ type: "error", code: "consent_declined", message: "Live voice was not started. Text interaction remains available." }); }
  function end() { cleanup("user_stop"); dispatch({ type: "end" }); setIntroductionState("not_started"); }
  function retry() { if (stateRef.current.reconnectAttempts >= 1) return; dispatch({ type: "reconnect" }); void startIntroOnlySession(); }
  function reconnectVoice() { retry(); }
  function stopSema() {
    cleanup("user_stop");
    publishDiagnostics({ failureBoundary: "playback_cleared_by_state_transition" });
    dispatch({ type: "end" });
    setIntroductionState("cooldown");
  }
  function setSpeakerMuted(muted: boolean) {
    if (muted) {
      playerRef.current?.stop();
      syncPlayerStats();
    }
    dispatch({ type: "mute_speaker", muted });
  }
  function setMicrophoneMuted(muted: boolean) {
    microphoneMutedRef.current = muted;
    if (muted) {
      clearMicrophoneBuffers();
      publishMicrophoneGate("muted", "muted");
    } else if (microphoneVoiceStateRef.current === "muted" && !completedOneTurnRef.current) {
      publishMicrophoneGate("ready_but_blocked", "not_listening");
    }
    publishDiagnostics({ microphoneMuted: muted });
    dispatch({ type: "mute_microphone", muted });
  }
  function copyDiagnostics() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    publishMicrophoneAccounting();
    publishPresentationDiagnostics();
    void navigator.clipboard.writeText(JSON.stringify(diagnosticsRef.current, null, 2));
  }

  async function confirmPending() {
    const pending = pendingToolRef.current;
    if (!pending) return;
    toolLedgerRef.current.set(pending.ledgerKey, { status: "approved" });
    pendingToolRef.current = undefined;
    publishDiagnostics({ pendingToolCallCount: 1, awaitingToolResponse: true });
    await executeValidatedTool(pending.call, pending.action, pending.ledgerKey);
    dispatch({ type: "permission_resolved" });
  }

  function denyPending() {
    const pending = pendingToolRef.current;
    if (!pending) return;
    const message = "The action was cancelled. Nothing was changed.";
    pendingToolRef.current = undefined;
    permissionPendingRef.current = false;
    actionRunningRef.current = false;
    publishDiagnostics({ pendingToolCallCount: 0, awaitingToolResponse: false });
    toolLedgerRef.current.set(pending.ledgerKey, { status: "cancelled", response: message });
    sendToolOutcome(pending.call, { status: "cancelled", message });
    toolLedgerRef.current.set(pending.ledgerKey, { status: "responded", response: message });
    dispatch({ type: "permission_resolved" });
  }

  return {
    state,
    voicePresentation,
    introductionState,
    publicStatus,
    requestStart,
    acceptConsent,
    declineConsent,
    confirmPending,
    denyPending,
    end,
    retry,
    retryVoiceOutput: () => undefined,
    reconnectVoice,
    continueWithText: () => dispatch({ type: "clear_voice_notice" }),
    setMicrophoneMuted,
    setSpeakerMuted,
    stopSema,
    canRetryVoiceOutput,
    clearTranscript: () => dispatch({ type: "clear_transcript" }),
    permissionDecision: state.pendingAction ? evaluatePermission(state.pendingAction.action) : undefined,
    copyDiagnostics
  };
}
