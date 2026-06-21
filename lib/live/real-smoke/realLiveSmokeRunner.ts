import {
  LIVE_SMOKE_TIMEOUTS,
  type RealLiveSmokeCleanup,
  type RealLiveSmokeConfiguration,
  type RealLiveSmokeDriver,
  type RealLiveSmokeResult,
  type RealLiveSmokeStage,
  type RealLiveSmokeStageEvent,
  type RealLiveSmokeTimeouts
} from "./realLiveSmokeTypes";

export class RealLiveSmokeError extends Error {
  constructor(readonly stage: RealLiveSmokeStage, readonly code: string) {
    super(`${stage}: ${code}`);
    this.name = "RealLiveSmokeError";
  }
}

type SmokeState = Omit<RealLiveSmokeResult, keyof RealLiveSmokeCleanup | "test" | "passed" | "latencyMs">;

const EMPTY_CLEANUP: RealLiveSmokeCleanup = {
  socketClosed: false,
  audioStopped: false,
  timersCleared: false,
  listenersRemoved: false,
  cleanupCompleted: false
};

function timeoutForStage(stage: RealLiveSmokeStage, timeouts: RealLiveSmokeTimeouts) {
  const values: Partial<Record<RealLiveSmokeStage, number>> = {
    creating_ephemeral_token: timeouts.tokenCreationMs,
    opening_constrained_socket: timeouts.socketOpenMs,
    awaiting_setup_complete: timeouts.setupCompleteMs,
    awaiting_spoken_output: timeouts.spokenOutputMs,
    awaiting_input_transcript: timeouts.inputTranscriptMs,
    awaiting_output_transcript: timeouts.outputTranscriptMs,
    awaiting_read_tool_call: timeouts.readToolCallMs,
    awaiting_post_tool_completion: timeouts.postToolCompletionMs,
    awaiting_write_tool_call: timeouts.writeToolCallMs,
    testing_interruption: timeouts.interruptionMs,
    testing_safety_refusal: timeouts.safetyResponseMs,
    closing_socket: timeouts.closeMs,
    cleaning_up: timeouts.closeMs
  };
  return values[stage] ?? timeouts.operationMs;
}

function initialState(): SmokeState {
  return {
    provider: "gemini_live",
    model: "unknown",
    voice: "unknown",
    fallbackUsed: false,
    tokenCreated: false,
    socketOpened: false,
    setupAccepted: false,
    spokenOutputReceived: false,
    inputTranscriptReceived: false,
    outputTranscriptReceived: false,
    readToolValidated: false,
    readToolCompletedAfterResult: false,
    writePermissionProduced: false,
    writeExecutedBeforePermission: false,
    interruptionObserved: false,
    playbackQueueCleared: false,
    safetyRefusalObserved: false
  };
}

export async function runRealLiveSmoke(
  driver: RealLiveSmokeDriver,
  options: {
    timeouts?: Partial<RealLiveSmokeTimeouts>;
    onStage?: (event: RealLiveSmokeStageEvent) => void;
  } = {}
): Promise<RealLiveSmokeResult> {
  const timeouts = { ...LIVE_SMOKE_TIMEOUTS, ...options.timeouts };
  const startedAt = Date.now();
  const state = initialState();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let activeStage: RealLiveSmokeStage = "initializing";
  let terminalFailure: RealLiveSmokeError | undefined;
  let cleanup = { ...EMPTY_CLEANUP };
  let globalReject!: (error: RealLiveSmokeError) => void;
  const globalTimeout = new Promise<never>((_, reject) => { globalReject = reject; });
  const watchdog = setTimeout(() => globalReject(new RealLiveSmokeError(activeStage, "global_timeout")), timeouts.globalMs);
  timers.add(watchdog);

  const emit = (stage: RealLiveSmokeStage, status: RealLiveSmokeStageEvent["status"], latencyMs?: number, code?: string) => {
    options.onStage?.({ event: "live_smoke_stage", stage, status, ...(latencyMs === undefined ? {} : { latencyMs }), ...(code ? { code } : {}), provider: state.provider, model: state.model === "unknown" ? undefined : state.model, voice: state.voice === "unknown" ? undefined : state.voice, fallbackUsed: false });
  };

  const runStage = async <T>(stage: RealLiveSmokeStage, operation: () => Promise<T>, includeGlobalWatchdog = true): Promise<T> => {
    activeStage = stage;
    const stageStartedAt = Date.now();
    emit(stage, "started");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stageTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RealLiveSmokeError(stage, "stage_timeout")), timeoutForStage(stage, timeouts));
      timers.add(timer);
    });
    try {
      const value = await Promise.race(includeGlobalWatchdog ? [operation(), stageTimeout, globalTimeout] : [operation(), stageTimeout]);
      emit(stage, "passed", Date.now() - stageStartedAt);
      return value;
    } catch (error) {
      const failure = error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError(stage, "operation_failed");
      emit(stage, failure.code.includes("timeout") ? "timed_out" : "failed", Date.now() - stageStartedAt, failure.code);
      throw failure;
    } finally {
      if (timer) {
        clearTimeout(timer);
        timers.delete(timer);
      }
    }
  };

  try {
    await runStage("initializing", () => driver.initialize());
    const configuration: RealLiveSmokeConfiguration = await runStage("loading_configuration", () => driver.loadConfiguration());
    Object.assign(state, configuration);
    if (configuration.fallbackUsed) throw new RealLiveSmokeError("loading_configuration", "fallback_not_allowed");
    await runStage("creating_ephemeral_token", () => driver.createEphemeralToken()); state.tokenCreated = true;
    await runStage("opening_constrained_socket", () => driver.openConstrainedSocket()); state.socketOpened = true;
    await runStage("sending_setup", () => driver.sendSetup());
    await runStage("awaiting_setup_complete", () => driver.awaitSetupComplete()); state.setupAccepted = true;
    await runStage("sending_synthetic_audio", () => driver.sendSyntheticAudio());
    await runStage("awaiting_spoken_output", () => driver.awaitSpokenOutput()); state.spokenOutputReceived = true;
    await runStage("awaiting_input_transcript", () => driver.awaitInputTranscript()); state.inputTranscriptReceived = true;
    await runStage("awaiting_output_transcript", () => driver.awaitOutputTranscript()); state.outputTranscriptReceived = true;
    await runStage("requesting_read_tool", () => driver.requestReadTool());
    await runStage("awaiting_read_tool_call", () => driver.awaitReadToolCall()); state.readToolValidated = true;
    await runStage("returning_read_tool_result", () => driver.returnReadToolResult());
    await runStage("awaiting_post_tool_completion", () => driver.awaitPostToolCompletion()); state.readToolCompletedAfterResult = true;
    await runStage("requesting_write_tool", () => driver.requestWriteTool());
    await runStage("awaiting_write_tool_call", () => driver.awaitWriteToolCall());
    await runStage("verifying_permission_state", () => driver.verifyPermissionState()); state.writePermissionProduced = true;
    await runStage("verifying_no_early_execution", () => driver.verifyNoEarlyExecution()); state.writeExecutedBeforePermission = false;
    await runStage("testing_interruption", () => driver.testInterruption()); state.interruptionObserved = true;
    await runStage("verifying_queue_clear", () => driver.verifyQueueClear()); state.playbackQueueCleared = true;
    await runStage("testing_safety_refusal", () => driver.testSafetyRefusal()); state.safetyRefusalObserved = true;
  } catch (error) {
    terminalFailure = error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError(activeStage, "unknown_error");
  } finally {
    clearTimeout(watchdog);
    timers.delete(watchdog);
    try {
      await runStage("closing_socket", () => driver.closeSocket(), false);
    } catch (error) {
      terminalFailure ??= error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError("closing_socket", "close_failed");
    }
    try {
      cleanup = await runStage("cleaning_up", () => driver.cleanup(), false);
    } catch (error) {
      terminalFailure ??= error instanceof RealLiveSmokeError ? error : new RealLiveSmokeError("cleaning_up", "cleanup_failed");
    }
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    cleanup.timersCleared = true;
  }

  const passed = !terminalFailure && cleanup.cleanupCompleted && cleanup.socketClosed && state.fallbackUsed === false;
  if (passed) await runStage("completed", async () => {}, false);
  return {
    test: "gemini_live_real_smoke",
    passed,
    ...state,
    ...cleanup,
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

export function exitCodeForSmokeResult(result: RealLiveSmokeResult) {
  return result.passed ? 0 : 1;
}
