import { loadEnvConfig } from "@next/env";
import { GeminiRealLiveSmokeDriver } from "../real-smoke/geminiRealLiveSmokeDriver";
import { createFinalResultReporter, exitCodeForSmokeResult, runRealLiveSmoke } from "../real-smoke/realLiveSmokeRunner";
import type { RealLiveSmokeResult } from "../real-smoke/realLiveSmokeTypes";

async function main() {
  const reportFinal = createFinalResultReporter((line) => process.stdout.write(line));
  let result: RealLiveSmokeResult | undefined;
  try {
    loadEnvConfig(process.cwd());
    result = await runRealLiveSmoke(new GeminiRealLiveSmokeDriver(), {
      onStage(event) { process.stdout.write(`${JSON.stringify(event)}\n`); }
    });
  } finally {
    if (!result) {
      result = {
        test: "gemini_live_real_smoke",
        passed: false,
        provider: "gemini_live",
        model: "unknown",
        voice: "unknown",
        fallbackUsed: false,
        syntheticAudioPrepared: false,
        syntheticAudioValidated: false,
        syntheticAudioDispatched: false,
        audioEndSignaled: false,
        textProbeDispatched: false,
        modelAudioReceived: false,
        modelAudioValidated: false,
        transcriptionReceived: false,
        tokenCreated: false,
        socketOpened: false,
        setupCompleted: false,
        readToolValidated: false,
        readToolCompletedAfterResult: false,
        writePermissionProduced: false,
        writeExecutedBeforePermission: false,
        interruptionObserved: false,
        playbackQueueCleared: false,
        safetyRefusalObserved: false,
        socketClosed: false,
        audioStopped: false,
        timersCleared: false,
        listenersRemoved: false,
        cleanupCompleted: false,
        failedStage: "initialization",
        errorCode: "unknown_error",
        latencyMs: 0
      };
    }
    reportFinal(result);
    const exitCode = exitCodeForSmokeResult(result);
    process.exitCode = exitCode;
    await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
    // The SDK may retain a closed WebSocket handle briefly. This fallback runs
    // only after cleanup and stdout flushing, and does not keep the process alive.
    setTimeout(() => process.exit(exitCode), 250).unref();
  }
}

void main().catch(() => { process.exitCode = 1; });
