import { loadEnvConfig } from "@next/env";
import { GeminiWriteToolProbeDriver } from "../write-tool-probe/geminiWriteToolProbeDriver";
import { createWriteToolProbeReporter, runWriteToolProbe, writeToolProbeExitCode } from "../write-tool-probe/writeToolProbeRunner";
import type { WriteToolProbeResult } from "../write-tool-probe/writeToolProbeTypes";

async function main() {
  const report = createWriteToolProbeReporter((line) => process.stdout.write(line));
  let result: WriteToolProbeResult | undefined;
  try {
    loadEnvConfig(process.cwd());
    result = await runWriteToolProbe(new GeminiWriteToolProbeDriver());
  } finally {
    result ??= {
      test: "gemini_live_write_tool_probe",
      passed: false,
      provider: "gemini_live",
      model: "unknown",
      voice: "unknown",
      fallbackUsed: false,
      tokenCreated: "not_run",
      socketOpened: "not_run",
      setupCompleted: "not_run",
      writePromptSent: "not_run",
      writeToolProposed: "not_run",
      writeToolNameValid: "not_run",
      writeToolPayloadValid: "not_run",
      canonicalRegistryValidated: "not_run",
      permissionRequired: "not_run",
      actionExecuted: "not_run",
      sessionMutated: "not_run",
      permissionResponseSent: "not_run",
      permissionAcknowledgementReceived: "not_run",
      earlyCompletionClaimDetected: "not_run",
      failedStage: "initialization",
      errorCode: "unknown_error",
      socketClosed: false,
      cleanupCompleted: false,
      sanitizedEvents: [],
      latencyMs: 0
    };
    report(result);
    const exitCode = writeToolProbeExitCode(result);
    process.exitCode = exitCode;
    await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
    setTimeout(() => process.exit(exitCode), 250).unref();
  }
}

void main().catch(() => { process.exitCode = 1; });
