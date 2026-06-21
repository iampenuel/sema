import { loadEnvConfig } from "@next/env";
import { createGeminiLiveDiagnosticDependencies } from "../diagnostics/geminiLiveDiagnosticProvider";
import { runLiveDiagnosticLadder, sanitizeDiagnosticText } from "../diagnostics/liveDiagnosticCore";

async function main() {
  loadEnvConfig(process.cwd());
  const report = await runLiveDiagnosticLadder(createGeminiLiveDiagnosticDependencies(), (stage) => {
    process.stdout.write(`${JSON.stringify({ test: "gemini_live_diagnostic_stage", ...stage })}\n`);
  });
  process.stdout.write(`${JSON.stringify({ test: "gemini_live_diagnostic", passed: report.passed, model: report.model, stagesCompleted: report.stages.length, fallbackUsed: false })}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ test: "gemini_live_diagnostic", passed: false, code: "unknown_error", providerReason: sanitizeDiagnosticText(error instanceof Error ? error.message : "Unknown diagnostic error"), fallbackUsed: false })}\n`);
  process.exitCode = 1;
});
