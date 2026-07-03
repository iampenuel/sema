import { ActivityHandling, EndSensitivity, Modality, StartSensitivity, ThinkingLevel, TurnCoverage, type LiveConnectConfig } from "@google/genai";
import { LIVE_CONTEXT_WINDOW_COMPRESSION, type SemaLiveThinkingLevel } from "./liveConfigCore";
import { LIVE_SYSTEM_INSTRUCTION } from "./liveSystemInstruction";
import { LIVE_FUNCTION_DECLARATIONS } from "./liveTools";
import { LIVE_PROVIDER_VAD_CONFIG } from "./liveTurnState";

export function thinkingLevelToGemini(level: SemaLiveThinkingLevel) {
  if (level === "minimal") return ThinkingLevel.MINIMAL;
  if (level === "low") return ThinkingLevel.LOW;
  if (level === "high") return ThinkingLevel.HIGH;
  return ThinkingLevel.MEDIUM;
}

export function buildGeminiLiveSessionConfig(input: {
  voiceName: string;
  thinkingLevel: SemaLiveThinkingLevel;
  temperature?: number;
  tools?: boolean;
  systemInstruction?: string;
}): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    temperature: input.temperature ?? 0.3,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceName } } },
    thinkingConfig: { thinkingLevel: thinkingLevelToGemini(input.thinkingLevel) },
    systemInstruction: input.systemInstruction ?? LIVE_SYSTEM_INSTRUCTION,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: LIVE_CONTEXT_WINDOW_COMPRESSION,
    realtimeInputConfig: {
      activityHandling: ActivityHandling.NO_INTERRUPTION,
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
        prefixPaddingMs: LIVE_PROVIDER_VAD_CONFIG.prefixPaddingMs,
        silenceDurationMs: LIVE_PROVIDER_VAD_CONFIG.silenceDurationMs
      },
      turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY
    },
    ...(input.tools === false ? {} : { tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }] })
  };
}

export function sanitizedLiveConfigurationAssertion(config: LiveConnectConfig) {
  return {
    modelConfigured: true,
    audioModalityConfigured: config.responseModalities?.includes(Modality.AUDIO) === true,
    voiceConfigured: Boolean(config.speechConfig),
    thinkingLevelConfigured: config.thinkingConfig?.thinkingLevel === ThinkingLevel.MEDIUM ? "medium" : config.thinkingConfig?.thinkingLevel,
    activityHandlingConfigured: config.realtimeInputConfig?.activityHandling,
    automaticVadEnabled: config.realtimeInputConfig?.automaticActivityDetection?.disabled === false,
    startSensitivityConfigured: config.realtimeInputConfig?.automaticActivityDetection?.startOfSpeechSensitivity === StartSensitivity.START_SENSITIVITY_LOW ? "LOW" : config.realtimeInputConfig?.automaticActivityDetection?.startOfSpeechSensitivity,
    endSensitivityConfigured: config.realtimeInputConfig?.automaticActivityDetection?.endOfSpeechSensitivity === EndSensitivity.END_SENSITIVITY_LOW ? "LOW" : config.realtimeInputConfig?.automaticActivityDetection?.endOfSpeechSensitivity,
    prefixPaddingMs: config.realtimeInputConfig?.automaticActivityDetection?.prefixPaddingMs,
    silenceDurationMs: config.realtimeInputConfig?.automaticActivityDetection?.silenceDurationMs,
    turnCoverageConfigured: config.realtimeInputConfig?.turnCoverage === TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY ? "ONLY_ACTIVITY" : config.realtimeInputConfig?.turnCoverage
  };
}
