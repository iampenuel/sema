import {
  LIVE_SMOKE_TIMEOUTS,
  type RealLiveSmokeCleanup,
  type RealLiveSmokeConfiguration,
  type RealLiveSmokeDriver,
  type RealLiveSmokeErrorCode,
  type RealLiveSmokeResult,
  type RealLiveSmokeStage,
  type RealLiveSmokeStageEvent,
  type RealLiveSmokeTimeouts
} from "./realLiveSmokeTypes";

export class RealLiveSmokeError extends Error {
  constructor(readonly stage: RealLiveSmokeStage, readonly code: RealLiveSmokeErrorCode) {
    super(`${stage}: ${code}`);
    this.name = "RealLiveSmokeError";
  }
}

type SmokeState = Omit<RealLiveSmokeResult, keyof RealLiveSmokeCleanup | "test" | "passed" | "latencyMs">;

const EXECUTION_STAGES: RealLiveSmokeStage[] = [
  "initialization", "configuration", "preparing_synthetic_audio", "validating_synthetic_audio",
  "creating_ephemeral_token", "opening_constrained_socket", "dispatching_setup", "waiting_for_setup_complete",
  "dispatching_synthetic_audio", "signaling_audio_end", "sending_text_audio_response_probe",
  "waiting_for_model_audio", "validating_model_audio", "validating_transcription", "testing_read_tool",
  "testing_write_permission", "testing_interruption", "testing_safety_refusal"
];

const EMPTY_CLEANUP: RealLiveSmokeCleanup = { socketClosed: false, audioStopped: false, timersCleared: false, listenersRemoved: false, cleanupCompleted: false };

function initialState(): SmokeState {
  return {
    provider: "gemini_live", model: "unknown", voice: "unknown", fallbackUsed: false,
    syntheticAudioPrepared: false, syntheticAudioValidated: false, syntheticAudioDispatched: false,
    audioEndSignaled: false, textProbeDispatched: false, modelAudioReceived: false,
    modelAudioValidated: false, transcriptionReceived: false, tokenCreated: false, socketOpened: false,
    setupCompleted: false, readToolValidated: false, readToolCompletedAfterResult: false,
    writePermissionProduced: false, writeExecutedBeforePermission: false, interruptionObserved: false,
    playbackQueueCleared: false, safetyRefusalObserved: false
  };
}

function timeoutForStage(stage: RealLiveSmokeStage, timeouts: RealLiveSmokeTimeouts) {
  const values: Partial<Record<RealLiveSmokeStage, number>> = {
    preparing_synthetic_audio: timeouts.preparingSyntheticAudioMs,
    validating_synthetic_audio: timeouts.validatingSyntheticAudioMs,
    creating_ephemeral_token: timeouts.tokenCreationMs,
    opening_constrained_socket: timeouts.socketOpenMs,
    waiting_for_setup_complete: timeouts.setupCompleteMs,
    dispatching_synthetic_audio: timeouts.dispatchingSyntheticAudioMs,
    signaling_audio_end: timeouts.signalingAudioEndMs,
    sending_text_audio_response_probe: timeouts.textProbeDispatchMs,
    waiting_for_model_audio: timeouts.modelAudioMs,
    validating_model_audio: timeouts.validationMs,
    validating_transcription: timeouts.validationMs,
    testing_read_tool: timeouts.readToolMs,
    testing_write_permission: timeouts.writePermissionMs,
    testing_interruption: timeouts.interruptionMs,
    testing_safety_refusal: timeouts.safetyResponseMs,
    closing_session: timeouts.closeMs,
    cleanup: timeouts.closeMs
  };
  return values[stage] ?? timeouts.operationMs;
}

function timeoutCode(stage: RealLiveSmokeStage): RealLiveSmokeErrorCode {
  if (stage === "preparing_synthetic_audio") return "synthetic_audio_prepare_timeout";
  if (stage === "dispatching_synthetic_audio") return "audio_dispatch_timeout";
  if (stage === "waiting_for_model_audio") return "model_audio_timeout";
  return "stage_timeout";
}

function failureCode(stage: RealLiveSmokeStage): RealLiveSmokeErrorCode {
  if (stage === "preparing_synthetic_audio") return "synthetic_audio_prepare_failed";
  if (stage === "validating_synthetic_audio") return "synthetic_audio_invalid";
  if (stage === "dispatching_synthetic_audio") return "audio_dispatch_failed";
  if (stage === "signaling_audio_end") return "audio_end_signal_failed";
  if (stage === "sending_text_audio_response_probe") return "text_probe_dispatch_failed";
  if (stage === "validating_model_audio") return "model_audio_invalid";
  return "operation_failed";
}

function operationErrorCode(error: unknown, stage: RealLiveSmokeStage): RealLiveSmokeErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (code === "socket_closed_early") return code;
    if (code === "rate_limited") return code;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/429|resource_exhausted|rate.?limit/.test(message)) return "rate_limited";
  if (/provider|gemini live socket/.test(message)) return "provider_error";
  return failureCode(stage);
}

export async function runRealLiveSmoke(
  driver: RealLiveSmokeDriver,
  options: { timeouts?: Partial<RealLiveSmokeTimeouts>; onStage?: (event: RealLiveSmokeStageEvent) => void } = {}
): Promise<RealLiveSmokeResult> {
  const timeouts = { ...LIVE_SMOKE_TIMEOUTS, ...options.timeouts };
  const startedAt = Date.now();
  const state = initialState();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let activeStage: RealLiveSmokeStage = "initialization";
  let terminalFailure: RealLiveSmokeError | undefined;
  let cleanup = { ...EMPTY_CLEANUP };
  let globalReject!: (error: RealLiveSmokeError) => void;
  const globalTimeout = new Promise<never>((_, reject) => { globalReject = reject; });
  const watchdog = setTimeout(() => globalReject(new RealLiveSmokeError(activeStage, "global_timeout")), timeouts.globalMs);
  timers.add(watchdog);

  const emit = (stage: RealLiveSmokeStage, status: RealLiveSmokeStageEvent["status"], latencyMs?: number, code?: RealLiveSmokeErrorCode) => {
    options.onStage?.({ event: "live_smoke_stage", stage, status, ...(latencyMs === undefined ? {} : { latencyMs }), ...(code ? { code } : {}), provider: state.provider, model: state.model === "unknown" ? undefined : state.model, voice: state.voice === "unknown" ? undefined : state.voice, fallbackUsed: false });
  };

  const runStage = async <T>(stage: RealLiveSmokeStage, operation: () => Promise<T>, includeGlobal = true): Promise<T> => {
    activeStage = stage;
    const stageStartedAt = Date.now();
    emit(stage, "started");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stageTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RealLiveSmokeError(stage, timeoutCode(stage))), timeoutForStage(stage, timeouts));
      timers.add(timer);
    });
    try {
      const value = await Promise.race(includeGlobal ? [operation(), stageTimeout, globalTimeout] : [operation(), stageTimeout]);
      emit(stage, "passed", Date.now() - stageStartedAt);
      return value;
    } catch (error) {
      const failure = error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError(stage, operationErrorCode(error, stage));
      emit(stage, failure.code.includes("timeout") ? "timed_out" : "failed", Date.now() - stageStartedAt, failure.code);
      throw failure;
    } finally {
      if (timer) { clearTimeout(timer); timers.delete(timer); }
    }
  };

  try {
    await runStage("initialization", () => driver.initialize());
    const configuration: RealLiveSmokeConfiguration = await runStage("configuration", () => driver.loadConfiguration());
    Object.assign(state, configuration);
    if (configuration.fallbackUsed) throw new RealLiveSmokeError("configuration", "fallback_not_allowed");
    await runStage("preparing_synthetic_audio", () => driver.prepareSyntheticAudio()); state.syntheticAudioPrepared = true;
    state.pcmMetadata = await runStage("validating_synthetic_audio", () => driver.validateSyntheticAudio()); state.syntheticAudioValidated = true;
    await runStage("creating_ephemeral_token", () => driver.createEphemeralToken()); state.tokenCreated = true;
    await runStage("opening_constrained_socket", () => driver.openConstrainedSocket()); state.socketOpened = true;
    await runStage("dispatching_setup", () => driver.dispatchSetup());
    await runStage("waiting_for_setup_complete", () => driver.waitForSetupComplete()); state.setupCompleted = true;
    await runStage("dispatching_synthetic_audio", () => driver.dispatchSyntheticAudio()); state.syntheticAudioDispatched = true;
    await runStage("signaling_audio_end", () => driver.signalAudioEnd()); state.audioEndSignaled = true;
    await runStage("sending_text_audio_response_probe", () => driver.sendTextAudioResponseProbe()); state.textProbeDispatched = true;
    await runStage("waiting_for_model_audio", () => driver.waitForModelAudio()); state.modelAudioReceived = true;
    await runStage("validating_model_audio", () => driver.validateModelAudio()); state.modelAudioValidated = true;
    const transcript = await runStage("validating_transcription", () => driver.validateTranscription());
    state.transcriptionReceived = transcript.received;
    state.transcriptionCharacterCount = transcript.characterCount;
    state.transcriptionSafetyValid = transcript.safetyValid;
    await runStage("testing_read_tool", () => driver.testReadTool()); state.readToolValidated = true; state.readToolCompletedAfterResult = true;
    await runStage("testing_write_permission", () => driver.testWritePermission()); state.writePermissionProduced = true; state.writeExecutedBeforePermission = false;
    await runStage("testing_interruption", () => driver.testInterruption()); state.interruptionObserved = true; state.playbackQueueCleared = true;
    await runStage("testing_safety_refusal", () => driver.testSafetyRefusal()); state.safetyRefusalObserved = true;
  } catch (error) {
    terminalFailure = error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError(activeStage, "unknown_error");
    const failedIndex = EXECUTION_STAGES.indexOf(terminalFailure.stage);
    for (const stage of EXECUTION_STAGES.slice(Math.max(0, failedIndex + 1))) emit(stage, "not_run");
  } finally {
    clearTimeout(watchdog);
    timers.delete(watchdog);
    try { await runStage("closing_session", () => driver.closeSocket(), false); }
    catch (error) { terminalFailure ??= error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError("closing_session", "operation_failed"); }
    try { cleanup = await runStage("cleanup", () => driver.cleanup(), false); }
    catch (error) { terminalFailure ??= error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError("cleanup", "operation_failed"); }
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    cleanup.timersCleared = true;
  }

  const passed = !terminalFailure && cleanup.cleanupCompleted && cleanup.socketClosed && state.fallbackUsed === false;
  return {
    test: "gemini_live_real_smoke", passed, ...state, ...cleanup,
    ...(terminalFailure ? { failedStage: terminalFailure.stage, errorCode: terminalFailure.code } : {}),
    latencyMs: Date.now() - startedAt
  };
}

export function createFinalResultReporter(write: (line: string) => void) {
  let reported = false;
  return (result: RealLiveSmokeResult) => {
    if (reported) return false;
    reported = true;
    write(`${JSON.stringify(result)}\n`);
    return true;
  };
}

export function exitCodeForSmokeResult(result: RealLiveSmokeResult) { return result.passed ? 0 : 1; }
