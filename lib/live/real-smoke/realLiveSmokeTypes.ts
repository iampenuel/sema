import type { PcmValidationMetadata } from "./syntheticPcm";

export type RealLiveSmokeStage =
  | "initialization"
  | "configuration"
  | "preparing_synthetic_audio"
  | "validating_synthetic_audio"
  | "creating_ephemeral_token"
  | "opening_constrained_socket"
  | "dispatching_setup"
  | "waiting_for_setup_complete"
  | "dispatching_synthetic_audio"
  | "signaling_audio_end"
  | "sending_text_audio_response_probe"
  | "waiting_for_model_audio"
  | "validating_model_audio"
  | "validating_transcription"
  | "testing_read_tool"
  | "testing_write_permission"
  | "testing_interruption"
  | "testing_safety_refusal"
  | "closing_session"
  | "cleanup";

export type RealLiveSmokeErrorCode =
  | "synthetic_audio_prepare_timeout"
  | "synthetic_audio_prepare_failed"
  | "synthetic_audio_invalid"
  | "audio_dispatch_failed"
  | "audio_dispatch_timeout"
  | "audio_end_signal_failed"
  | "text_probe_dispatch_failed"
  | "model_audio_timeout"
  | "model_audio_invalid"
  | "transcription_missing"
  | "provider_error"
  | "socket_closed_early"
  | "rate_limited"
  | "global_timeout"
  | "stage_timeout"
  | "operation_failed"
  | "fallback_not_allowed"
  | "unknown_error";

export type RealLiveSmokeTimeouts = {
  preparingSyntheticAudioMs: number;
  validatingSyntheticAudioMs: number;
  tokenCreationMs: number;
  socketOpenMs: number;
  setupCompleteMs: number;
  dispatchingSyntheticAudioMs: number;
  signalingAudioEndMs: number;
  textProbeDispatchMs: number;
  modelAudioMs: number;
  validationMs: number;
  readToolMs: number;
  writePermissionMs: number;
  interruptionMs: number;
  safetyResponseMs: number;
  closeMs: number;
  operationMs: number;
  globalMs: number;
};

export const LIVE_SMOKE_TIMEOUTS: RealLiveSmokeTimeouts = {
  preparingSyntheticAudioMs: 15_000,
  validatingSyntheticAudioMs: 2_000,
  tokenCreationMs: 15_000,
  socketOpenMs: 10_000,
  setupCompleteMs: 10_000,
  dispatchingSyntheticAudioMs: 3_000,
  signalingAudioEndMs: 2_000,
  textProbeDispatchMs: 3_000,
  modelAudioMs: 20_000,
  validationMs: 2_000,
  readToolMs: 15_000,
  writePermissionMs: 15_000,
  interruptionMs: 10_000,
  safetyResponseMs: 15_000,
  closeMs: 5_000,
  operationMs: 5_000,
  globalMs: 120_000
};

export type RealLiveSmokeStageEvent = {
  event: "live_smoke_stage";
  stage: RealLiveSmokeStage;
  status: "started" | "passed" | "failed" | "timed_out" | "not_run";
  latencyMs?: number;
  code?: RealLiveSmokeErrorCode;
  provider?: "gemini_live";
  model?: string;
  voice?: string;
  fallbackUsed: false;
};

export type RealLiveSmokeCleanup = {
  socketClosed: boolean;
  audioStopped: boolean;
  timersCleared: boolean;
  listenersRemoved: boolean;
  cleanupCompleted: boolean;
};

export type RealLiveSmokeResult = RealLiveSmokeCleanup & {
  test: "gemini_live_real_smoke";
  passed: boolean;
  provider: "gemini_live";
  model: string;
  voice: string;
  fallbackUsed: false;
  syntheticAudioPrepared: boolean;
  syntheticAudioValidated: boolean;
  syntheticAudioDispatched: boolean;
  audioEndSignaled: boolean;
  textProbeDispatched: boolean;
  modelAudioReceived: boolean;
  modelAudioValidated: boolean;
  transcriptionReceived: boolean;
  tokenCreated: boolean;
  socketOpened: boolean;
  setupCompleted: boolean;
  readToolValidated: boolean;
  readToolCompletedAfterResult: boolean;
  writePermissionProduced: boolean;
  writeExecutedBeforePermission: boolean;
  interruptionObserved: boolean;
  playbackQueueCleared: boolean;
  safetyRefusalObserved: boolean;
  pcmMetadata?: PcmValidationMetadata;
  transcriptionCharacterCount?: number;
  transcriptionSafetyValid?: boolean;
  failedStage?: RealLiveSmokeStage;
  errorCode?: RealLiveSmokeErrorCode;
  latencyMs: number;
};

export type RealLiveSmokeConfiguration = {
  provider: "gemini_live";
  model: string;
  voice: string;
  fallbackUsed: false;
};

export interface RealLiveSmokeDriver {
  initialize(): Promise<void>;
  loadConfiguration(): Promise<RealLiveSmokeConfiguration>;
  prepareSyntheticAudio(): Promise<void>;
  validateSyntheticAudio(): Promise<PcmValidationMetadata>;
  createEphemeralToken(): Promise<void>;
  openConstrainedSocket(): Promise<void>;
  dispatchSetup(): Promise<void>;
  waitForSetupComplete(): Promise<void>;
  dispatchSyntheticAudio(): Promise<void>;
  signalAudioEnd(): Promise<void>;
  sendTextAudioResponseProbe(): Promise<void>;
  waitForModelAudio(): Promise<void>;
  validateModelAudio(): Promise<void>;
  validateTranscription(): Promise<{ received: boolean; characterCount?: number; safetyValid?: boolean }>;
  testReadTool(): Promise<void>;
  testWritePermission(): Promise<void>;
  testInterruption(): Promise<void>;
  testSafetyRefusal(): Promise<void>;
  closeSocket(): Promise<void>;
  cleanup(): Promise<RealLiveSmokeCleanup>;
}
