import type {
  ProbeCheck,
  WriteToolProbeConfiguration,
  WriteToolProbeDriver,
  WriteToolProbeErrorCode,
  WriteToolProbeResult,
  WriteToolProbeStage
} from "./writeToolProbeTypes";

export type WriteToolProbeTimeouts = {
  operationMs: number;
  tokenMs: number;
  socketMs: number;
  setupMs: number;
  promptMs: number;
  toolCallMs: number;
  validationMs: number;
  permissionMs: number;
  responseMs: number;
  acknowledgementMs: number;
  closeMs: number;
  cleanupMs: number;
  globalMs: number;
};

export const WRITE_TOOL_PROBE_TIMEOUTS: WriteToolProbeTimeouts = {
  operationMs: 3_000,
  tokenMs: 10_000,
  socketMs: 10_000,
  setupMs: 10_000,
  promptMs: 3_000,
  toolCallMs: 20_000,
  validationMs: 2_000,
  permissionMs: 2_000,
  responseMs: 3_000,
  acknowledgementMs: 15_000,
  closeMs: 5_000,
  cleanupMs: 5_000,
  globalMs: 90_000
};

export class WriteToolProbeError extends Error {
  constructor(readonly stage: WriteToolProbeStage, readonly code: WriteToolProbeErrorCode) {
    super(`${stage}: ${code}`);
    this.name = "WriteToolProbeError";
  }
}

type ProbeState = Omit<WriteToolProbeResult, "test" | "passed" | "socketClosed" | "cleanupCompleted" | "sanitizedEvents" | "latencyMs" | "failedStage" | "errorCode">;

function initialState(): ProbeState {
  const pending: ProbeCheck = "not_run";
  return {
    provider: "gemini_live", model: "unknown", voice: "unknown", fallbackUsed: false,
    tokenCreated: pending, socketOpened: pending, setupCompleted: pending, writePromptSent: pending,
    writeToolProposed: pending, writeToolNameValid: pending, writeToolPayloadValid: pending,
    canonicalRegistryValidated: pending, permissionRequired: pending, actionExecuted: pending,
    sessionMutated: pending, permissionResponseSent: pending, permissionAcknowledgementReceived: pending,
    earlyCompletionClaimDetected: pending
  };
}

function timeoutFor(stage: WriteToolProbeStage, timeouts: WriteToolProbeTimeouts) {
  const values: Partial<Record<WriteToolProbeStage, number>> = {
    creating_ephemeral_token: timeouts.tokenMs,
    opening_socket: timeouts.socketMs,
    waiting_for_setup_complete: timeouts.setupMs,
    sending_write_request: timeouts.promptMs,
    waiting_for_write_tool_call: timeouts.toolCallMs,
    validating_write_tool_call: timeouts.validationMs,
    checking_canonical_registry: timeouts.validationMs,
    evaluating_permission_gate: timeouts.permissionMs,
    sending_confirmation_required_response: timeouts.responseMs,
    waiting_for_permission_acknowledgement: timeouts.acknowledgementMs,
    validating_no_early_completion_claim: timeouts.validationMs,
    closing_session: timeouts.closeMs,
    cleanup: timeouts.cleanupMs
  };
  return values[stage] ?? timeouts.operationMs;
}

function timeoutCode(stage: WriteToolProbeStage): WriteToolProbeErrorCode {
  if (stage === "waiting_for_write_tool_call") return "write_tool_timeout";
  if (stage === "waiting_for_permission_acknowledgement") return "permission_acknowledgement_timeout";
  return "unknown_error";
}

function normalizeError(error: unknown, stage: WriteToolProbeStage): WriteToolProbeError {
  if (error instanceof WriteToolProbeError) return error;
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code) as WriteToolProbeErrorCode;
    return new WriteToolProbeError(stage, code);
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/429|resource_exhausted|rate.?limit/.test(message)) return new WriteToolProbeError(stage, "rate_limited");
  if (/provider|gemini live socket/.test(message)) return new WriteToolProbeError(stage, "provider_error");
  if (stage === "sending_write_request") return new WriteToolProbeError(stage, "write_prompt_dispatch_failed");
  if (stage === "sending_confirmation_required_response") return new WriteToolProbeError(stage, "tool_response_failed");
  return new WriteToolProbeError(stage, "unknown_error");
}

export async function runWriteToolProbe(
  driver: WriteToolProbeDriver,
  options: { timeouts?: Partial<WriteToolProbeTimeouts> } = {}
): Promise<WriteToolProbeResult> {
  const timeouts = { ...WRITE_TOOL_PROBE_TIMEOUTS, ...options.timeouts };
  const startedAt = Date.now();
  const state = initialState();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let activeStage: WriteToolProbeStage = "initialization";
  let failure: WriteToolProbeError | undefined;
  let socketClosed = false;
  let cleanupCompleted = false;
  let globalReject!: (error: WriteToolProbeError) => void;
  const globalTimeout = new Promise<never>((_, reject) => { globalReject = reject; });
  const watchdog = setTimeout(() => globalReject(new WriteToolProbeError(activeStage, "global_timeout")), timeouts.globalMs);
  timers.add(watchdog);

  const stage = async <T>(name: WriteToolProbeStage, operation: () => Promise<T>, includeGlobal = true) => {
    activeStage = name;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WriteToolProbeError(name, timeoutCode(name))), timeoutFor(name, timeouts));
      timers.add(timer);
    });
    try {
      return await Promise.race(includeGlobal ? [operation(), timeout, globalTimeout] : [operation(), timeout]);
    } catch (error) {
      throw normalizeError(error, name);
    } finally {
      if (timer) { clearTimeout(timer); timers.delete(timer); }
    }
  };

  try {
    await stage("initialization", () => driver.initialize());
    const configuration: WriteToolProbeConfiguration = await stage("configuration", () => driver.loadConfiguration());
    Object.assign(state, configuration);
    if (configuration.fallbackUsed) throw new WriteToolProbeError("configuration", "unknown_error");
    await stage("creating_ephemeral_token", () => driver.createEphemeralToken()); state.tokenCreated = true;
    await stage("opening_socket", () => driver.openSocket()); state.socketOpened = true;
    await stage("dispatching_setup", () => driver.dispatchSetup());
    await stage("waiting_for_setup_complete", () => driver.waitForSetupComplete()); state.setupCompleted = true;
    await stage("sending_write_request", () => driver.sendWriteRequest()); state.writePromptSent = true;
    await stage("waiting_for_write_tool_call", () => driver.waitForWriteToolCall()); state.writeToolProposed = true;
    await stage("validating_write_tool_call", () => driver.validateWriteToolCall()); state.writeToolNameValid = true; state.writeToolPayloadValid = true;
    await stage("checking_canonical_registry", () => driver.checkCanonicalRegistry()); state.canonicalRegistryValidated = true;
    const permission = await stage("evaluating_permission_gate", () => driver.evaluatePermissionGate());
    state.permissionRequired = permission.permissionRequired;
    state.actionExecuted = permission.actionExecuted;
    state.sessionMutated = permission.sessionMutated;
    await stage("sending_confirmation_required_response", () => driver.sendConfirmationRequiredResponse()); state.permissionResponseSent = true;
    await stage("waiting_for_permission_acknowledgement", () => driver.waitForPermissionAcknowledgement()); state.permissionAcknowledgementReceived = true;
    await stage("validating_no_early_completion_claim", () => driver.validateNoEarlyCompletionClaim()); state.earlyCompletionClaimDetected = false;
  } catch (error) {
    failure = normalizeError(error, activeStage);
  } finally {
    clearTimeout(watchdog);
    timers.delete(watchdog);
    try { await stage("closing_session", () => driver.closeSocket(), false); }
    catch (error) { failure ??= normalizeError(error, "closing_session"); }
    try {
      const cleanup = await stage("cleanup", () => driver.cleanup(), false);
      socketClosed = cleanup.socketClosed;
      cleanupCompleted = cleanup.cleanupCompleted;
    } catch (error) { failure ??= normalizeError(error, "cleanup"); }
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  const passed = !failure && socketClosed && cleanupCompleted && state.fallbackUsed === false;
  return {
    test: "gemini_live_write_tool_probe", passed, ...state,
    ...(failure ? { failedStage: failure.stage, errorCode: failure.code } : {}),
    socketClosed, cleanupCompleted, sanitizedEvents: driver.getSanitizedEvents(), latencyMs: Date.now() - startedAt
  };
}

export function writeToolProbeExitCode(result: WriteToolProbeResult) { return result.passed ? 0 : 1; }

export function createWriteToolProbeReporter(write: (line: string) => void) {
  let reported = false;
  return (result: WriteToolProbeResult) => {
    if (reported) return false;
    reported = true;
    write(`${JSON.stringify(result)}\n`);
    return true;
  };
}
