import { createGeminiLiveDiagnosticDependencies } from "./diagnostics/geminiLiveDiagnosticProvider";
import { runLiveDiagnosticLadder } from "./diagnostics/liveDiagnosticCore";

export async function preflightGeminiLive(timeoutMs = 15_000) {
  return runLiveDiagnosticLadder(createGeminiLiveDiagnosticDependencies(timeoutMs));
}
