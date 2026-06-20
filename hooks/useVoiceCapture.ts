"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useBrowserDictation } from "./useBrowserDictation";
import { buildRecordingBlob, classifyMicrophoneError, MAX_DEMO_RECORDING_SECONDS, requestBrowserMicrophone, revokeObjectUrl, stopMediaTracks } from "@/lib/voice/mediaRecorder";
import { detectVoiceSupport, selectSupportedMimeType } from "@/lib/voice/voiceSupport";
import { createInitialVoiceState, voiceCaptureReducer } from "@/lib/voice/voiceReducer";
import type { VoiceTargetFolder } from "@/lib/voice/voiceTypes";

export function useVoiceCapture(initialTarget: VoiceTargetFolder = "audio") {
  const [state, dispatch] = useReducer(voiceCaptureReducer, initialTarget, createInitialVoiceState);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const limitReachedRef = useRef(false);

  const onFinalTranscript = useCallback((transcript: string) => dispatch({ type: "set_transcript", transcript }), []);
  const dictation = useBrowserDictation(onFinalTranscript);

  const clearTimer = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const cleanMedia = useCallback(() => {
    clearTimer();
    stopMediaTracks(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    dictation.stop();
  }, [clearTimer, dictation]);

  const stop = useCallback((limitReached = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    limitReachedRef.current = limitReached;
    dispatch({ type: "stopping" });
    clearTimer();
    dictation.stop();
    recorder.stop();
  }, [clearTimer, dictation]);

  useEffect(() => {
    const support = detectVoiceSupport({
      navigator,
      MediaRecorder: window.MediaRecorder,
      SpeechRecognition: (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition,
      webkitSpeechRecognition: (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    });
    dispatch({ type: "support_checked", supported: support.microphone && support.mediaRecorder, transcriptSupported: support.dictation });
  }, []);

  useEffect(() => {
    dispatch({ type: "set_interim", transcript: dictation.interim });
    dispatch({ type: "dictation_active", active: dictation.active });
  }, [dictation.active, dictation.interim]);

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder !== "function") {
      dispatch({ type: "permission_failed", code: "microphone_unsupported", message: "Browser recording is unavailable. You can continue with typed notes." });
      return false;
    }
    dispatch({ type: "request_permission" });
    try {
      const result = await requestBrowserMicrophone((constraints) => navigator.mediaDevices.getUserMedia(constraints));
      if (result.granted) {
        dispatch({ type: "permission_granted" });
        return true;
      }
      dispatch({ type: "permission_failed", code: result.code, message: result.message });
      return false;
    } catch (error) {
      const classified = classifyMicrophoneError(error);
      dispatch({ type: "permission_failed", ...classified });
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder !== "function" || recorderRef.current) return false;
    try {
      revokeObjectUrl(objectUrlRef.current);
      objectUrlRef.current = undefined;
      cancelledRef.current = false;
      limitReachedRef.current = false;
      chunksRef.current = [];
      dictation.reset();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = selectSupportedMimeType(window.MediaRecorder);
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        cleanMedia();
        dispatch({ type: "error", code: "recording_failed", message: "Browser recording stopped unexpectedly. Typed notes remain available." });
      };
      recorder.onstop = () => {
        const elapsed = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const chunks = chunksRef.current;
        const wasCancelled = cancelledRef.current;
        cleanMedia();
        if (wasCancelled) return;
        const blob = buildRecordingBlob(chunks, recorder.mimeType || mimeType || "audio/webm");
        if (!blob) {
          dispatch({ type: "error", code: "empty_recording", message: "No audio was captured. Try again or continue with typed notes." });
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        dispatch({ type: "review", blob, objectUrl, durationSeconds: Math.min(elapsed, MAX_DEMO_RECORDING_SECONDS), mimeType: blob.type, limitReached: limitReachedRef.current });
      };
      recorder.start(500);
      dispatch({ type: "start", recordingId: `voice-${Date.now()}`, startedAt: startedAtRef.current, mimeType: recorder.mimeType || mimeType });
      dictation.start();
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        dispatch({ type: "tick", elapsedSeconds: elapsed });
        if (elapsed >= MAX_DEMO_RECORDING_SECONDS) stop(true);
      }, 1000);
      return true;
    } catch (error) {
      cleanMedia();
      const classified = classifyMicrophoneError(error);
      dispatch({ type: "permission_failed", ...classified });
      return false;
    }
  }, [cleanMedia, dictation, stop]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording" && typeof recorderRef.current.pause === "function") {
      recorderRef.current.pause();
      dictation.stop();
      dispatch({ type: "pause" });
    }
  }, [dictation]);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused" && typeof recorderRef.current.resume === "function") {
      recorderRef.current.resume();
      dictation.start();
      dispatch({ type: "resume" });
    }
  }, [dictation]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    cleanMedia();
    revokeObjectUrl(objectUrlRef.current);
    objectUrlRef.current = undefined;
    chunksRef.current = [];
    dictation.reset();
    dispatch({ type: "cancelled" });
  }, [cleanMedia, dictation]);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    cleanMedia();
    revokeObjectUrl(objectUrlRef.current);
    objectUrlRef.current = undefined;
    chunksRef.current = [];
    dictation.reset();
    dispatch({ type: "reset" });
  }, [cleanMedia, dictation]);

  useEffect(() => () => {
    cancelledRef.current = true;
    clearTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    stopMediaTracks(streamRef.current);
    streamRef.current = null;
    revokeObjectUrl(objectUrlRef.current);
    objectUrlRef.current = undefined;
  }, [clearTimer]);

  return {
    state,
    support: detectVoiceSupport({
      navigator: typeof navigator === "undefined" ? undefined : navigator,
      MediaRecorder: typeof window === "undefined" ? undefined : window.MediaRecorder,
      SpeechRecognition: typeof window === "undefined" ? undefined : (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition,
      webkitSpeechRecognition: typeof window === "undefined" ? undefined : (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    }),
    dictationFailed: dictation.failed,
    requestPermission,
    start,
    stop,
    pause,
    resume,
    cancel,
    reset,
    setTranscript: (transcript: string) => dispatch({ type: "set_transcript", transcript }),
    setTarget: (target: VoiceTargetFolder) => dispatch({ type: "set_target", target }),
    markSaving: () => dispatch({ type: "saving" }),
    returnToReview: () => dispatch({ type: "return_to_review" }),
    markSaved: () => dispatch({ type: "saved" })
  };
}

export type VoiceCaptureController = ReturnType<typeof useVoiceCapture>;
