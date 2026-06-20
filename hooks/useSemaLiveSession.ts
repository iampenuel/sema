"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AgentAction } from "@/lib/agent/agentTypes";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import type { SemaSession } from "@/lib/sema-session/types";
import type { SafetyFlag } from "@/lib/sema-session/types";
import { base64ToPcm16, bytesToBase64, float32ToPcm16, LIVE_OUTPUT_SAMPLE_RATE, resampleFloat32 } from "@/lib/live/liveAudio";
import { buildLiveSessionContext, diffLiveSessionContext, type LiveSessionContext } from "@/lib/live/buildLiveSessionContext";
import { GeminiLiveProvider } from "@/lib/live/providers/geminiLiveProvider";
import { LIVE_SAFE_REDIRECT, screenLiveInput, screenLiveOutput } from "@/lib/live/liveSafety";
import { initialLiveState, liveStateReducer } from "@/lib/live/liveStateMachine";
import { validateLiveToolCall } from "@/lib/live/liveTools";
import type { LiveProvider, LiveProviderEvent, LivePublicStatus, LiveTokenResponse, LiveTranscriptLine, LiveToolCall } from "@/lib/live/liveTypes";

type Options = {
  session: SemaSession;
  executeAction: (action: AgentAction) => string;
  onSafetyFlags: (flags: SafetyFlag[]) => void;
  providerFactory?: () => LiveProvider;
};

export type SemaLiveController = ReturnType<typeof useSemaLiveSession>;

function transcriptLine(role: LiveTranscriptLine["role"], text: string, final = true): LiveTranscriptLine {
  return { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`, role, text, final };
}

export function useSemaLiveSession({ session, executeAction, onSafetyFlags, providerFactory }: Options) {
  const [state, dispatch] = useReducer(liveStateReducer, initialLiveState);
  const [publicStatus, setPublicStatus] = useState<LivePublicStatus | null>(null);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const executeRef = useRef(executeAction);
  const providerRef = useRef<LiveProvider | undefined>(undefined);
  const contextRef = useRef<LiveSessionContext | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const inputContextRef = useRef<AudioContext | undefined>(undefined);
  const outputContextRef = useRef<AudioContext | undefined>(undefined);
  const workletRef = useRef<AudioWorkletNode | undefined>(undefined);
  const processorRef = useRef<ScriptProcessorNode | undefined>(undefined);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const outputTimeRef = useRef(0);
  const turnAudioRef = useRef<Array<{ data: string; generation: number }>>([]);
  const turnTextRef = useRef("");
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speechFramesRef = useRef(0);
  const awaitingProviderInterruptRef = useRef(false);
  const locallyInterruptedRef = useRef(false);
  const pendingCallRef = useRef<LiveToolCall | undefined>(undefined);
  const unsafeTurnRef = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { executeRef.current = executeAction; }, [executeAction]);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/live/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((value: LivePublicStatus) => { if (active) setPublicStatus(value); })
      .catch(() => { if (active) setPublicStatus({ uiEnabled: false, available: false, provider: "gemini_live", model: "", voiceName: "", maxSessionMinutes: 10, publicDemoTokenEnabled: false, reason: "Live status is unavailable." }); });
    return () => { active = false; };
  }, []);

  const stopPlayback = useCallback(() => {
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch { /* source already ended */ }
    }
    sourcesRef.current.clear();
    outputTimeRef.current = 0;
    turnAudioRef.current = [];
  }, []);

  const playBufferedTurn = useCallback(async () => {
    const chunks = turnAudioRef.current;
    turnAudioRef.current = [];
    if (!chunks.length || stateRef.current.speakerMuted) return;
    const context = outputContextRef.current ?? new AudioContext();
    outputContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    const activeGeneration = stateRef.current.activeGeneration;
    let startAt = Math.max(context.currentTime + 0.02, outputTimeRef.current);
    for (const chunk of chunks) {
      if (chunk.generation !== activeGeneration) continue;
      const samples = base64ToPcm16(chunk.data);
      const buffer = context.createBuffer(1, samples.length, LIVE_OUTPUT_SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(startAt);
      startAt += buffer.duration;
      sourcesRef.current.add(source);
      source.onended = () => sourcesRef.current.delete(source);
    }
    outputTimeRef.current = startAt;
    dispatch({ type: "speak" });
  }, []);

  const finishTurn = useCallback(() => {
    const text = turnTextRef.current.trim();
    turnTextRef.current = "";
    const screened = screenLiveOutput(text);
    if (!text || !screened.safe) {
      stopPlayback();
      dispatch({ type: "transcript", line: transcriptLine("system", LIVE_SAFE_REDIRECT) });
      dispatch({ type: "listen" });
      return;
    }
    void playBufferedTurn();
  }, [playBufferedTurn, stopPlayback]);

  const handleToolCall = useCallback((call: LiveToolCall) => {
    const provider = providerRef.current;
    if (unsafeTurnRef.current) {
      provider?.sendToolResult(call, { ok: false, message: "No action is available for a request that crosses Sema's safety boundary." });
      return;
    }
    if (pendingCallRef.current) {
      provider?.sendToolResult(call, { ok: false, message: "Finish the visible permission request before another action." });
      return;
    }
    const validated = validateLiveToolCall(call, sessionRef.current);
    if (!validated.ok) {
      provider?.sendToolResult(call, { ok: false, message: validated.message });
      dispatch({ type: "transcript", line: transcriptLine("system", validated.message) });
      return;
    }
    if (validated.permissionRequired) {
      pendingCallRef.current = call;
      dispatch({ type: "permission", pending: { call, action: validated.action } });
      return;
    }
    const message = executeRef.current(validated.action);
    provider?.sendToolResult(call, { ok: true, message });
    dispatch({ type: "transcript", line: transcriptLine("sema", message) });
  }, []);

  const handleProviderEvent = useCallback((event: LiveProviderEvent) => {
    switch (event.type) {
      case "open": dispatch({ type: "connected" }); break;
      case "close": if (stateRef.current.status !== "ended") dispatch({ type: "error", code: "connection_failed", message: event.reason || "The Live connection closed. Text interaction is still available." }); break;
      case "error": dispatch({ type: "error", code: event.code, message: event.message }); break;
      case "audio": if (!awaitingProviderInterruptRef.current) { turnAudioRef.current.push({ data: event.data, generation: stateRef.current.activeGeneration }); dispatch({ type: "think" }); } break;
      case "input_transcript": {
        dispatch({ type: "transcript", line: transcriptLine("user", event.text, event.final) });
        if (event.final) {
          const screened = screenLiveInput(event.text);
          if (!screened.safe) {
            unsafeTurnRef.current = true;
            onSafetyFlags(screened.flags);
            stopPlayback();
            providerRef.current?.sendContextDelta(`[Safety boundary] Respond exactly with: ${LIVE_SAFE_REDIRECT} Do not call a tool.`);
          }
        }
        break;
      }
      case "output_transcript": turnTextRef.current = event.text; dispatch({ type: "transcript", line: transcriptLine("sema", event.text, event.final) }); break;
      case "tool_call": handleToolCall(event.call); break;
      case "interrupted": {
        stopPlayback();
        awaitingProviderInterruptRef.current = false;
        const pending = stateRef.current.pendingAction;
        if (pending) providerRef.current?.sendToolResult(pending.call, { ok: false, message: "The pending action was cancelled when the conversation was interrupted." });
        pendingCallRef.current = undefined;
        if (locallyInterruptedRef.current) {
          locallyInterruptedRef.current = false;
          dispatch({ type: "listen" });
        } else {
          dispatch({ type: "interrupt" });
        }
        break;
      }
      case "turn_complete": finishTurn(); unsafeTurnRef.current = false; break;
    }
  }, [finishTurn, handleToolCall, onSafetyFlags, stopPlayback]);

  const sendSamples = useCallback((samples: Float32Array, sourceRate: number) => {
    const current = stateRef.current;
    if (current.microphoneMuted || !providerRef.current) return;
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / Math.max(1, samples.length));
    speechFramesRef.current = rms > 0.035 ? speechFramesRef.current + 1 : 0;
    if (speechFramesRef.current === 2 && current.status === "speaking") {
      stopPlayback();
      awaitingProviderInterruptRef.current = true;
      locallyInterruptedRef.current = true;
      dispatch({ type: "interrupt" });
    }
    const pcm = float32ToPcm16(resampleFloat32(samples, sourceRate));
    providerRef.current.sendAudio(bytesToBase64(pcm));
  }, [stopPlayback]);

  const startMicrophone = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    streamRef.current = stream;
    const context = new AudioContext();
    inputContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const silent = context.createGain();
    silent.gain.value = 0;
    try {
      await context.audioWorklet.addModule("/audio/sema-live-capture-worklet.js");
      const worklet = new AudioWorkletNode(context, "sema-live-capture");
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => sendSamples(new Float32Array(event.data), context.sampleRate);
      source.connect(worklet).connect(silent).connect(context.destination);
      workletRef.current = worklet;
    } catch {
      const processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => sendSamples(new Float32Array(event.inputBuffer.getChannelData(0)), context.sampleRate);
      source.connect(processor).connect(silent).connect(context.destination);
      processorRef.current = processor;
    }
  }, [sendSamples]);

  const cleanup = useCallback(() => {
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    stopPlayback();
    providerRef.current?.endAudio();
    providerRef.current?.close();
    providerRef.current = undefined;
    pendingCallRef.current = undefined;
    awaitingProviderInterruptRef.current = false;
    locallyInterruptedRef.current = false;
    unsafeTurnRef.current = false;
    workletRef.current?.disconnect();
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void inputContextRef.current?.close();
    void outputContextRef.current?.close();
    streamRef.current = undefined;
    inputContextRef.current = undefined;
    outputContextRef.current = undefined;
  }, [stopPlayback]);

  const connect = useCallback(async () => {
    if (!publicStatus?.available) {
      dispatch({ type: "error", code: "disabled", message: publicStatus?.reason ?? "Sema Live is unavailable. Text interaction is still available." });
      return;
    }
    try {
      dispatch({ type: "request_microphone" });
      outputContextRef.current = new AudioContext();
      await outputContextRef.current.resume();
      await startMicrophone();
      dispatch({ type: "request_token" });
      const nonce = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const response = await fetch("/api/ai/live/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce }) });
      const body = await response.json() as LiveTokenResponse & { error?: string; code?: string };
      if (!response.ok) throw new Error(body.code || body.error || "Live token unavailable");
      dispatch({ type: "connect" });
      const provider = providerFactory ? providerFactory() : new GeminiLiveProvider();
      providerRef.current = provider;
      await provider.connect(body, handleProviderEvent);
      const firstContext = buildLiveSessionContext(sessionRef.current);
      contextRef.current = firstContext;
      provider.sendContextDelta(diffLiveSessionContext(undefined, firstContext));
      sessionTimerRef.current = setTimeout(() => {
        cleanup();
        dispatch({ type: "error", code: "session_expired", message: "The 10-minute Live session ended. You can continue by text." });
      }, publicStatus.maxSessionMinutes * 60_000);
    } catch (error) {
      cleanup();
      const text = error instanceof Error ? error.message.toLowerCase() : "";
      const code = text.includes("rate") || text.includes("429") ? "rate_limited" : text.includes("timeout") ? "timeout" : text.includes("permission") || text.includes("notallowed") ? "microphone_denied" : "connection_failed";
      dispatch({ type: "error", code, message: code === "microphone_denied" ? "Microphone access was not allowed. Text interaction remains available." : "Sema Live could not connect. Text interaction remains available." });
    }
  }, [cleanup, handleProviderEvent, providerFactory, publicStatus, startMicrophone]);

  useEffect(() => {
    if (!providerRef.current || !["listening", "thinking", "speaking", "awaiting_confirmation", "interrupted"].includes(state.status)) return;
    const next = buildLiveSessionContext(session, state.pendingAction?.action.label);
    const delta = diffLiveSessionContext(contextRef.current, next);
    if (delta) providerRef.current.sendContextDelta(delta);
    contextRef.current = next;
  }, [session, state.pendingAction, state.status]);

  useEffect(() => cleanup, [cleanup]);

  function requestStart() { dispatch({ type: "request_consent" }); }
  function acceptConsent() { dispatch({ type: "consent" }); void connect(); }
  function declineConsent() { dispatch({ type: "error", code: "consent_declined", message: "Live voice was not started. Text interaction remains available." }); }
  function confirmPending() {
    const pending = stateRef.current.pendingAction;
    if (!pending) return;
    const message = executeRef.current(pending.action);
    providerRef.current?.sendToolResult(pending.call, { ok: true, message });
    pendingCallRef.current = undefined;
    dispatch({ type: "transcript", line: transcriptLine("sema", message) });
    dispatch({ type: "permission_resolved" });
  }
  function denyPending() {
    const pending = stateRef.current.pendingAction;
    if (!pending) return;
    providerRef.current?.sendToolResult(pending.call, { ok: false, message: "The user declined this action." });
    pendingCallRef.current = undefined;
    dispatch({ type: "permission_resolved" });
  }
  function end() { cleanup(); dispatch({ type: "end" }); }
  function retry() { if (stateRef.current.reconnectAttempts >= 1) return; dispatch({ type: "reconnect" }); void connect(); }
  function setMicrophoneMuted(muted: boolean) { streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted; }); dispatch({ type: "mute_microphone", muted }); }
  function setSpeakerMuted(muted: boolean) { if (muted) stopPlayback(); dispatch({ type: "mute_speaker", muted }); }

  return {
    state, publicStatus, requestStart, acceptConsent, declineConsent, confirmPending, denyPending, end, retry,
    setMicrophoneMuted, setSpeakerMuted,
    clearTranscript: () => dispatch({ type: "clear_transcript" }),
    permissionDecision: state.pendingAction ? evaluatePermission(state.pendingAction.action) : undefined
  };
}
