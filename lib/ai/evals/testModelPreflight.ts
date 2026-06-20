import { loadTestEnvironment } from "./loadTestEnvironment";
import { preflightGeminiModel } from "../modelPreflight";

const PREFLIGHT_ATTEMPTS = 2;
const PREFLIGHT_RETRY_MS = 60000;

const waitForRetry = () => new Promise<void>((resolve) => setTimeout(resolve, PREFLIGHT_RETRY_MS));

async function main() {
  loadTestEnvironment();
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.SEMA_AI_MODEL || "gemini-3.5-flash";
  if (!apiKey) {
    process.stderr.write("CONFIGURATION_REQUIRED: Add GEMINI_API_KEY and Sema AI settings manually to the Git-ignored .env.local file before running model preflight.\n");
    process.exitCode = 2;
    return;
  }
  let result = await preflightGeminiModel({ apiKey, model, timeoutMs: Number(process.env.SEMA_AI_TIMEOUT_MS || 15000) });
  for (let attempt = 1; !result.ok && attempt < PREFLIGHT_ATTEMPTS && (result.errorCode === "rate_limited" || result.errorCode === "provider_unavailable"); attempt += 1) {
    await waitForRetry();
    result = await preflightGeminiModel({ apiKey, model, timeoutMs: Number(process.env.SEMA_AI_TIMEOUT_MS || 15000) });
  }
  process.stdout.write(`${JSON.stringify({ test: "model_preflight", model: result.model, passed: result.ok, modelListed: result.modelListed, generateContentSupported: result.generateContentSupported, structuredOutputValid: result.structuredOutputValid, latencyMs: result.latencyMs, errorCode: result.errorCode, stableFlashAlternatives: result.ok ? [] : result.availableStableFlashModels })}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    process.stderr.write(`MODEL_PREFLIGHT_FAILED: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exit(1);
  }
);
