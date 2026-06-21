export type RealLiveSmokeStage =
  | "initializing"
  | "loading_configuration"
  | "creating_ephemeral_token"
  | "opening_constrained_socket"
  | "sending_setup"
  | "awaiting_setup_complete"
  | "sending_synthetic_audio"
  | "awaiting_spoken_output"
  | "awaiting_input_transcript"
  | "awaiting_output_transcript"
  | "requesting_read_tool"
  | "awaiting_read_tool_call"
  | "returning_read_tool_result"
  | "awaiting_post_tool_completion"
  | "requesting_write_tool"
  | "awaiting_write_tool_call"
  | "verifying_permission_state"
  | "verifying_no_early_execution"
  | "testing_interruption"
  | "verifying_queue_clear"
  | "testing_safety_refusal"
  | "closing_socket"
  | "cleaning_up"
  | "completed";

export type RealLiveSmokeTimeouts = {
  tokenCreationMs: number;
  socketOpenMs: number;
  setupCompleteMs: number;
  spokenOutputMs: number;
  inputTranscriptMs: number;
  outputTranscriptMs: number;
  readToolCallMs: number;
  postToolCompletionMs: number;
  writeToolCallMs: number;
  interruptionMs: number;
  safetyResponseMs: number;
  closeMs: number;
  operationMs: number;
  globalMs: number;
};

export const LIVE_SMOKE_TIMEOUTS: RealLiveSmokeTimeouts = {
  tokenCreationMs: 15_000,
  socketOpenMs: 10_000,
  setupCompleteMs: 10_000,
  spokenOutputMs: 20_000,
  inputTranscriptMs: 15_000,
  outputTranscriptMs: 20_000,
  readToolCallMs: 15_000,
  postToolCompletionMs: 15_000,
  writeToolCallMs: 15_000,
  interruptionMs: 10_000,
  safetyResponseMs: 15_000,
  closeMs: 5_000,
  operationMs: 5_000,
  globalMs: 120_000
};

export type RealLiveSmokeStageEvent = {
  event: "live_smoke_stage";
  stage: RealLiveSmokeStage;
  status: "started" | "passed" | "failed" | "timed_out";
  latencyMs?: number;
  code?: string;
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
  tokenCreated: boolean;
  socketOpened: boolean;
  setupAccepted: boolean;
  spokenOutputReceived: boolean;
  inputTranscriptReceived: boolean;
  outputTranscriptReceived: boolean;
  readToolValidated: boolean;
  readToolCompletedAfterResult: boolean;
  writePermissionProduced: boolean;
  writeExecutedBeforePermission: boolean;
  interruptionObserved: boolean;
  playbackQueueCleared: boolean;
  safetyRefusalObserved: boolean;
  failedStage?: RealLiveSmokeStage;
  errorCode?: string;
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
  createEphemeralToken(): Promise<void>;
  openConstrainedSocket(): Promise<void>;
  sendSetup(): Promise<void>;
  awaitSetupComplete(): Promise<void>;
  sendSyntheticAudio(): Promise<void>;
  awaitSpokenOutput(): Promise<void>;
  awaitInputTranscript(): Promise<void>;
  awaitOutputTranscript(): Promise<void>;
  requestReadTool(): Promise<void>;
  awaitReadToolCall(): Promise<void>;
  returnReadToolResult(): Promise<void>;
  awaitPostToolCompletion(): Promise<void>;
  requestWriteTool(): Promise<void>;
  awaitWriteToolCall(): Promise<void>;
  verifyPermissionState(): Promise<void>;
  verifyNoEarlyExecution(): Promise<void>;
  testInterruption(): Promise<void>;
  verifyQueueClear(): Promise<void>;
  testSafetyRefusal(): Promise<void>;
  closeSocket(): Promise<void>;
  cleanup(): Promise<RealLiveSmokeCleanup>;
}
