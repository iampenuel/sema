import { GoogleGenAI, Modality, type LiveConnectConfig } from "@google/genai";
import { getLiveConfig } from "../liveConfig";
import { LIVE_SYSTEM_INSTRUCTION } from "../liveSystemInstruction";
import { LIVE_FUNCTION_DECLARATIONS } from "../liveTools";
import { buildLiveTokenTimes } from "../liveTokenPolicy";
import { thinkingLevelToGemini } from "../liveSessionConfig";
import { createGeminiLiveDiagnosticDependencies } from "./geminiLiveDiagnosticProvider";
import { classifyDiagnosticFailure, TOKEN_API_VERSION, withDiagnosticTimeout, type LiveDiagnosticCode } from "./liveDiagnosticCore";

export const LIVE_CONSTRAINT_FEATURES = [
  "model",
  "audio_response",
  "voice_kore",
  "thinking_medium",
  "system_instruction",
  "input_transcription",
  "output_transcription",
  "one_read_only_tool",
  "full_approved_tools"
] as const;

export type LiveConstraintFeature = typeof LIVE_CONSTRAINT_FEATURES[number];
export const CONSTRAINT_PROBE_LOCK_ADDITIONAL_FIELDS: string[] = [];
export type ConstraintProbeResult = {
  stage: "constraint_probe";
  feature: LiveConstraintFeature;
  passed: boolean;
  code?: LiveDiagnosticCode;
  latencyMs?: number;
  providerStatus?: number;
  providerReason?: string;
  model: string;
  apiVersion: "v1alpha";
  tokenCreated: boolean;
  socketOpened: boolean;
  setupAccepted: boolean;
  fallbackUsed: false;
};

export function buildConstraintConfig(feature: LiveConstraintFeature, voiceName: string): LiveConnectConfig | undefined {
  const index = LIVE_CONSTRAINT_FEATURES.indexOf(feature);
  if (index < 1) return undefined;
  const config: LiveConnectConfig = { responseModalities: [Modality.AUDIO] };
  if (index >= 2) config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName } } };
  if (index >= 3) config.thinkingConfig = { thinkingLevel: thinkingLevelToGemini(getLiveConfig().thinkingLevel) };
  if (index >= 4) config.systemInstruction = LIVE_SYSTEM_INSTRUCTION;
  if (index >= 5) config.inputAudioTranscription = {};
  if (index >= 6) config.outputAudioTranscription = {};
  if (index >= 7) config.tools = [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS.filter((tool) => tool.name === "openSignalFolder") }];
  if (index >= 8) config.tools = [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }];
  return config;
}

export function buildTokenConstraintConfig(feature: LiveConstraintFeature, voiceName: string): LiveConnectConfig | undefined {
  const config = buildConstraintConfig(feature, voiceName);
  if (!config || !config.tools) return config;
  const tokenCompatibleConfig = { ...config };
  delete tokenCompatibleConfig.tools;
  return tokenCompatibleConfig;
}

export type ConstraintProbeExecutor = (feature: LiveConstraintFeature) => Promise<Omit<ConstraintProbeResult, "stage" | "feature" | "model" | "apiVersion" | "fallbackUsed">>;

export async function runConstraintProbes(model: string, execute: ConstraintProbeExecutor, onProbe?: (result: ConstraintProbeResult) => void) {
  const results: ConstraintProbeResult[] = [];
  for (const feature of LIVE_CONSTRAINT_FEATURES) {
    const startedAt = Date.now();
    let result: ConstraintProbeResult;
    try {
      result = { stage: "constraint_probe", feature, model, apiVersion: TOKEN_API_VERSION, fallbackUsed: false, ...(await execute(feature)), latencyMs: Date.now() - startedAt };
    } catch (error) {
      const failure = classifyDiagnosticFailure(error, "constraint_probe", feature);
      result = { stage: "constraint_probe", feature, model, apiVersion: TOKEN_API_VERSION, fallbackUsed: false, passed: false, tokenCreated: false, socketOpened: false, setupAccepted: false, ...failure, latencyMs: Date.now() - startedAt };
    }
    results.push(result);
    onProbe?.(result);
    if (!result.passed) return { passed: false, results, fallbackUsed: false as const };
  }
  return { passed: true, results, fallbackUsed: false as const };
}

export function createGeminiConstraintProbeExecutor(timeoutMs = 15_000): ConstraintProbeExecutor {
  const config = getLiveConfig();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return async (feature) => {
    const { expiresAt, newSessionExpiresAt } = buildLiveTokenTimes(Date.now(), config.maxSessionMinutes);
    const tokenClient = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: TOKEN_API_VERSION } });
    const connectionConfig = buildConstraintConfig(feature, config.voiceName);
    const embeddedConfig = buildTokenConstraintConfig(feature, config.voiceName);
    const token = await withDiagnosticTimeout(tokenClient.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt.toISOString(),
        newSessionExpireTime: newSessionExpiresAt.toISOString(),
        httpOptions: { apiVersion: TOKEN_API_VERSION },
        liveConnectConstraints: { model: config.model, ...(embeddedConfig ? { config: embeddedConfig } : {}) },
        // An empty list asks the SDK to lock only fields present in the token setup.
        // Without this field mask, a partial incremental setup replaces the entire setup.
        lockAdditionalFields: CONSTRAINT_PROBE_LOCK_ADDITIONAL_FIELDS
      }
    }), timeoutMs, `Constraint token creation for ${feature}`);
    if (!token.name) throw new Error("Token response missing name");
    const connector = createGeminiLiveDiagnosticDependencies(timeoutMs);
    const outcome = await connector.connectConstrained(
      { name: token.name, expiresAt: expiresAt.toISOString() },
      connectionConfig ?? { responseModalities: [Modality.AUDIO] }
    );
    return { passed: true, tokenCreated: true, ...outcome };
  };
}
