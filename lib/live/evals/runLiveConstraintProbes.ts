import { loadEnvConfig } from "@next/env";
import { getLiveConfig } from "../liveConfig";
import { createGeminiConstraintProbeExecutor, runConstraintProbes } from "../diagnostics/liveConstraintProbes";
import { sanitizeDiagnosticText } from "../diagnostics/liveDiagnosticCore";

async function main() {
  loadEnvConfig(process.cwd());
  const config = getLiveConfig();
  const report = await runConstraintProbes(config.model, createGeminiConstraintProbeExecutor(), (probe) => {
    process.stdout.write(`${JSON.stringify({ test: "gemini_live_constraint", ...probe })}\n`);
  });
  process.stdout.write(`${JSON.stringify({ test: "gemini_live_constraints", passed: report.passed, probesCompleted: report.results.length, fallbackUsed: false })}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ test: "gemini_live_constraints", passed: false, code: "unknown_error", providerReason: sanitizeDiagnosticText(error instanceof Error ? error.message : "Unknown constraint error"), fallbackUsed: false })}\n`);
  process.exitCode = 1;
});
