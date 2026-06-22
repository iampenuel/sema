import { emitProbeEvent } from "../write-tool-probe/probeEventProtocol";

const startedAt = Date.now();

async function main() {
  await emitProbeEvent({ type: "lifecycle", event: "child_started", elapsedMs: 0 });
  await emitProbeEvent({ type: "lifecycle", event: "loading_runner", elapsedMs: Date.now() - startedAt });
  try {
    const { runWriteToolProbeChild } = await import("./runWriteToolProbeChildRunner");
    await emitProbeEvent({ type: "lifecycle", event: "runner_loaded", elapsedMs: Date.now() - startedAt });
    process.exitCode = await runWriteToolProbeChild(startedAt);
  } catch {
    await emitProbeEvent({ type: "terminal", passed: false, errorCode: "runner_load_failed", failedStage: "loading_runner", cleanupCompleted: false, fallbackUsed: false });
    process.exitCode = 2;
  }
}

void main();
