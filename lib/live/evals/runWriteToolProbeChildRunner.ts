import { loadEnvConfig } from "@next/env";
import { GeminiWriteToolProbeDriver } from "../write-tool-probe/geminiWriteToolProbeDriver";
import { emitProbeEvent, type WriteProbeLifecycleEvent } from "../write-tool-probe/probeEventProtocol";
import { runWriteToolProbe } from "../write-tool-probe/writeToolProbeRunner";
import type { WriteToolProbeStage } from "../write-tool-probe/writeToolProbeTypes";

const lifecycleForStage: Partial<Record<WriteToolProbeStage, WriteProbeLifecycleEvent>> = {
  creating_ephemeral_token: "token_request_start", opening_socket: "socket_opening",
  dispatching_setup: "setup_sent", waiting_for_setup_complete: "setup_sent",
  sending_write_request: "write_prompt_sent", waiting_for_write_tool_call: "waiting_for_tool",
  evaluating_permission_gate: "permission_checked", sending_confirmation_required_response: "tool_response_sent",
  waiting_for_permission_acknowledgement: "waiting_for_acknowledgement", closing_session: "closing_socket", cleanup: "cleanup_start"
};

export async function runWriteToolProbeChild(startedAt: number): Promise<number> {
  const abortController = new AbortController();
  let activeStage: WriteToolProbeStage = "initialization";
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const emitLifecycle = (event: WriteProbeLifecycleEvent, toolName?: string) => void emitProbeEvent({ type: "lifecycle", event, elapsedMs: Date.now() - startedAt, ...(toolName ? { toolName } : {}) });
  const stopHeartbeat = () => { if (heartbeat) clearInterval(heartbeat); heartbeat = undefined; };
  const onStage = (stage: WriteToolProbeStage) => {
    activeStage = stage; stopHeartbeat();
    const event = lifecycleForStage[stage]; if (event) emitLifecycle(event);
    if (stage === "waiting_for_write_tool_call" || stage === "waiting_for_permission_acknowledgement") {
      const heartbeatStage = stage === "waiting_for_write_tool_call" ? "waiting_for_tool" : "waiting_for_acknowledgement";
      heartbeat = setInterval(() => void emitProbeEvent({ type: "heartbeat", stage: heartbeatStage, elapsedMs: Date.now() - startedAt }), 5_000);
    }
  };
  const onStageComplete = (stage: WriteToolProbeStage) => {
    if (stage === activeStage) stopHeartbeat();
    if (stage === "evaluating_permission_gate") emitLifecycle("permission_checked");
  };
  const globalTimeout = setTimeout(() => abortController.abort("child_global_timeout"), 55_000);
  const terminate = () => abortController.abort("parent_termination");
  process.once("SIGTERM", terminate);
  await emitProbeEvent({ type: "lifecycle", event: "probe_starting", elapsedMs: Date.now() - startedAt });
  let result;
  try {
    loadEnvConfig(process.cwd());
    const driver = new GeminiWriteToolProbeDriver(
      abortController.signal,
      (event, toolName) => emitLifecycle(event, toolName),
      () => abortController.abort("provider_failure")
    );
    result = await runWriteToolProbe(driver, { signal: abortController.signal, onStage, onStageComplete });
  } finally {
    stopHeartbeat(); clearTimeout(globalTimeout); process.removeListener("SIGTERM", terminate); abortController.abort("terminal");
  }
  await emitProbeEvent({
    type: "terminal", passed: result.passed, ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.failedStage ? { failedStage: result.failedStage } : {}), cleanupCompleted: result.cleanupCompleted,
    fallbackUsed: false, result: result as unknown as Record<string, unknown>
  });
  return result.passed ? 0 : result.errorCode === "child_global_timeout" ? 2 : 1;
}
