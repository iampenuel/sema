import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEmptySession } from "../../sema-session/defaults";
import { buildEvidencePacket } from "../../packet/buildPacket";
import { ActivityHandling, EndSensitivity, Modality, StartSensitivity, ThinkingLevel, TurnCoverage } from "@google/genai";
import { LIVE_CONTEXT_WINDOW_COMPRESSION, liveConnectionRolloverDelayMs, resolveLiveConfig } from "../liveConfigCore";
import { canCompleteLivePlayback, float32ToPcm16, LIVE_INPUT_CHUNK_BYTES, OrderedPcmQueue, PcmChunkAccumulator, resampleFloat32 } from "../liveAudio";
import { isLiveAudioMimeType, isValidLiveAudioBase64, normalizeGeminiLiveServerEvent } from "../liveEventProcessor";
import { buildGeminiLiveSessionConfig, sanitizedLiveConfigurationAssertion } from "../liveSessionConfig";
import { buildLiveSessionContext, diffLiveSessionContext } from "../buildLiveSessionContext";
import { LIVE_TOOL_NAMES, validateLiveToolCall } from "../liveTools";
import { initialLiveState, liveStateReducer } from "../liveStateMachine";
import { screenLiveInput, screenLiveOutput } from "../liveSafety";
import { LiveTokenRateLimiter, safeTokenResponse } from "../liveTokenPolicy";
import { buildLiveTokenTimes } from "../liveTokenPolicy";
import { MockLiveProvider } from "../providers/mockLiveProvider";
import type { LiveIntroDiagnostics } from "../liveIntroControl";
import type { LivePublicStatus, LiveRuntimeState } from "../liveTypes";
import {
  CONSTRAINED_LIVE_ENDPOINT,
  CONSTRAINED_TOKEN_QUERY_PARAMETER,
  DIRECT_LIVE_API_VERSION,
  LiveDiagnosticFailure,
  TOKEN_API_VERSION,
  classifyDiagnosticFailure,
  resolveTokenSetupSemantics,
  runLiveDiagnosticLadder,
  sanitizeDiagnosticText,
  withDiagnosticTimeout,
  type DiagnosticDependencies
} from "../diagnostics/liveDiagnosticCore";
import { CONSTRAINT_PROBE_LOCK_ADDITIONAL_FIELDS, LIVE_CONSTRAINT_FEATURES, buildTokenConstraintConfig, runConstraintProbes } from "../diagnostics/liveConstraintProbes";
import { FakeRealLiveSmokeDriver } from "./fakeRealLiveSmokeDriver";
import { createFinalResultReporter, exitCodeForSmokeResult, runRealLiveSmoke } from "../real-smoke/realLiveSmokeRunner";
import type { RealLiveSmokeStage, RealLiveSmokeStageEvent } from "../real-smoke/realLiveSmokeTypes";
import { audioBoundaryMessages, createDeterministicPcmFixture, validateModelAudio, validateSyntheticPcm } from "../real-smoke/syntheticPcm";
import { LIVE_SYSTEM_INSTRUCTION } from "../liveSystemInstruction";
import { LIVE_INTRODUCTION, LIVE_INTRODUCTION_PROMPT, LIVE_REENTRY_MESSAGE } from "../liveIntroduction";
import { LIVE_FUNCTION_DECLARATIONS } from "../liveTools";
import { LIVE_MICROPHONE_CONSTRAINTS, LIVE_POST_PLAYBACK_COOLDOWN_MS, LIVE_PROVIDER_VAD_CONFIG, canForwardMicrophonePcm, canForwardPcm } from "../liveTurnState";
import { LIVE_OUTPUT_DEGRADED_MESSAGE, LIVE_OUTPUT_RECONNECTING_MESSAGE, LIVE_OUTPUT_WATCHDOG, createLiveOutputDiagnostics, estimateBase64Bytes } from "../liveOutputState";
import { buildGeminiLiveIntroSetup, buildGeminiLiveIntroTextMessage, createLiveIntroDiagnostics } from "../liveIntroControl";
import { GeminiLiveIntroClient } from "../liveIntroClient";
import { normalizeGeminiServerFrame, parseNormalizedGeminiServerFrame } from "../liveIntroFrame";
import { classifyGeminiLiveIntroServerMessage, isLiveIntroAudioMimeType, parseGeminiLiveIntroServerMessage } from "../liveIntroParser";
import { canForwardPhase1CMicrophonePcm, LiveMicrophonePcmEncoder } from "../liveMicrophoneCapture";
import { LiveOutputTurnGate, phase1CCooldownMs } from "../liveOutputTurnGate";
import { LIVE_PLAYER_DRAIN_GRACE_MS, decodeBase64Pcm16LittleEndian, evaluateLivePcmDrainWatchdog } from "../livePcmOutputPlayer";
import { liveVoicePresentationForState, liveVoiceStatusInvariant } from "../liveVoicePresentation";
import { FakeWriteToolProbeDriver } from "./fakeWriteToolProbeDriver";
import {
  WRITE_TOOL_PROBE_DECLARATIONS,
  WRITE_TOOL_PROBE_PROMPT,
  WRITE_TOOL_PROBE_SYSTEM_INSTRUCTION,
  classifyToollessTurn,
  createConfirmationRequiredResponse,
  createWriteRequestRealtimeInput,
  evaluateCanonicalWritePermission,
  hasEarlyCompletionClaim,
  isConfirmationRequiredAcknowledgement,
  sanitizeWriteProbeEvent,
  validateCanonicalWriteAction,
  validateDedicatedWriteCall
} from "../write-tool-probe/writeToolProbeCore";
import { createWriteToolProbeReporter, runWriteToolProbe, writeToolProbeExitCode } from "../write-tool-probe/writeToolProbeRunner";

let passed = 0;
const root = process.cwd();
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => { passed += 1; process.stdout.write(`PASS ${name}\n`); });
}

async function waitForTestCondition(predicate: () => boolean, timeoutMs = 250) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail("Timed out waiting for test condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const session = createEmptySession();
const approved = {
  ...session,
  concernType: "other" as const,
  story: {
    rawText: "Patient-provided demo story.",
    summaryStatus: "approved" as const,
    structuredSummary: {
      mainConcern: "Demo concern",
      timeline: [], affectedAreas: [], changesOverTime: [], triggersOrPatterns: [], patientConcerns: [], missingDetails: [], clinicianQuestions: [],
      summaryNote: "Organized from patient-provided information.", source: "ai_organized_from_patient_provided_information" as const
    }
  },
  folderStatus: { ...session.folderStatus, story: "saved" as const }
};
const packetReadyApproved = {
  ...approved,
  folderStatus: {
    ...approved.folderStatus,
    body_location: "not_applicable" as const,
    audio: "not_applicable" as const,
    motion_visual: "not_applicable" as const
  }
};

function livePresentation(state: Partial<LiveRuntimeState>, diagnostics: Partial<LiveIntroDiagnostics> = {}) {
  return liveVoicePresentationForState(
    { ...initialLiveState, ...state },
    { ...createLiveIntroDiagnostics(), ...diagnostics }
  );
}

async function main() {
await test("defaults keep Live disabled", () => assert.equal(resolveLiveConfig({}).liveEnabled, false));
await test("UI flag is explicit", () => assert.equal(resolveLiveConfig({ NEXT_PUBLIC_SEMA_LIVE_UI_ENABLED: "true" }).uiEnabled, true));
await test("default model is Gemini Live preview", () => assert.match(resolveLiveConfig({}).model, /live-preview/));
await test("default voice is Kore", () => assert.equal(resolveLiveConfig({}).voiceName, "Kore"));
await test("thinking level medium is accepted", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_THINKING_LEVEL: "medium" }).thinkingLevel, "medium"));
await test("missing thinking level defaults to medium", () => assert.equal(resolveLiveConfig({}).thinkingLevel, "medium"));
await test("invalid thinking level safely normalizes to medium", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_THINKING_LEVEL: "fast" }).thinkingLevel, "medium"));
await test("session limit is capped at ten", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_MAX_SESSION_MINUTES: "40" }).maxSessionMinutes, 10));
await test("session limit has a one-minute floor", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_MAX_SESSION_MINUTES: "0" }).maxSessionMinutes, 1));
await test("Live connection rolls before its ten-minute boundary", () => assert.equal(liveConnectionRolloverDelayMs(10), 540_000));
await test("short configured sessions retain a safe rollover floor", () => assert.equal(liveConnectionRolloverDelayMs(1), 30_000));
await test("long conversations use sliding-window compression", () => assert.deepEqual(LIVE_CONTEXT_WINDOW_COMPRESSION, { slidingWindow: {} }));
await test("Live introduction uses the exact guided script", () => {
  assert.equal(LIVE_INTRODUCTION, "Hi, I’m Sema. I’ll help you organize what you’ve noticed for a clinician. You can type, tap, or talk. We can start with your story, where you noticed something, or another section you choose.");
  assert.ok(LIVE_INTRODUCTION_PROMPT.includes(JSON.stringify(LIVE_INTRODUCTION)));
  assert.ok(LIVE_INTRODUCTION_PROMPT.includes("Do not add anything else and do not call a tool"));
});
await test("Live re-entry message is shorter and separate", () => assert.equal(LIVE_REENTRY_MESSAGE, "Welcome back. We can continue where you left off, or you can choose another section."));
await test("Live intro no longer says typing is unnecessary", () => assert.doesNotMatch(LIVE_INTRODUCTION, /no typing|keyboard|control everything/i));
await test("development token requires key and enablement", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret" }).tokenMintingAllowed, true));
await test("production token is disabled by default", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret" }, "production").tokenMintingAllowed, false));
await test("production public-demo flag permits token", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret", SEMA_LIVE_PUBLIC_DEMO_ENABLED: "true" }, "production").tokenMintingAllowed, true));
await test("Vercel Preview is not classified as Production", () => {
  const config = resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret", VERCEL_ENV: "preview" }, "production");
  assert.equal(config.deploymentEnvironment, "preview");
  assert.equal(config.production, false);
  assert.equal(config.tokenMintingAllowed, true);
});
await test("Vercel Production remains public-demo gated", () => {
  const config = resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret", VERCEL_ENV: "production" }, "production");
  assert.equal(config.deploymentEnvironment, "production");
  assert.equal(config.production, true);
  assert.equal(config.tokenMintingAllowed, false);
});

await test("state asks for consent", () => assert.equal(liveStateReducer(initialLiveState, { type: "request_consent" }).status, "consent_required"));
await test("microphone state cannot precede consent flow", () => assert.equal(liveStateReducer(initialLiveState, { type: "request_consent" }).consented, false));
await test("state records consent", () => assert.equal(liveStateReducer(initialLiveState, { type: "consent" }).consented, true));
await test("state connects to listening", () => assert.equal(liveStateReducer(initialLiveState, { type: "connected" }).status, "listening"));
await test("state tracks speaking", () => assert.equal(liveStateReducer(initialLiveState, { type: "speak" }).status, "speaking"));
await test("turn state connects to listening", () => assert.equal(liveStateReducer(initialLiveState, { type: "connected" }).turnState, "listening"));
await test("turn state blocks microphone while thinking", () => assert.equal(canForwardPcm(liveStateReducer(initialLiveState, { type: "think" }).turnState), false));
await test("turn state blocks microphone while assistant is speaking", () => assert.equal(canForwardPcm(liveStateReducer(initialLiveState, { type: "speak" }).turnState), false));
await test("turn state allows microphone only while listening or user speaking", () => {
  assert.equal(canForwardPcm("listening"), true);
  assert.equal(canForwardPcm("user_speaking"), true);
  assert.equal(canForwardPcm("closing_user_turn"), false);
  assert.equal(canForwardPcm("post_playback_cooldown"), false);
});
await test("single PCM gate blocks prohibited output states", () => {
  assert.equal(canForwardMicrophonePcm("listening", "idle", false), true);
  assert.equal(canForwardMicrophonePcm("listening", "buffering", false), false);
  assert.equal(canForwardMicrophonePcm("listening", "playing", false), false);
  assert.equal(canForwardMicrophonePcm("listening", "draining", false), false);
  assert.equal(canForwardMicrophonePcm("listening", "recovering_player", false), false);
  assert.equal(canForwardMicrophonePcm("listening", "degraded_text_only", false), false);
  assert.equal(canForwardMicrophonePcm("listening", "idle", true), false);
});
await test("post-playback cooldown is calibrated to 400 ms", () => assert.equal(LIVE_POST_PLAYBACK_COOLDOWN_MS, 400));
await test("microphone constraints use ideal echo processing", () => {
  assert.deepEqual(LIVE_MICROPHONE_CONSTRAINTS, { audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, channelCount: { ideal: 1 }, sampleRate: { ideal: 16000 } }, video: false });
});
await test("provider VAD uses no-interruption and conservative timing", () => assert.deepEqual(LIVE_PROVIDER_VAD_CONFIG, { activityHandling: "NO_INTERRUPTION", turnCoverage: "ONLY_ACTIVITY", automaticVadEnabled: true, startOfSpeechSensitivity: "LOW", endOfSpeechSensitivity: "LOW", prefixPaddingMs: 200, silenceDurationMs: 650 }));
await test("canonical Live config includes medium thinking and no interruption", () => {
  const config = buildGeminiLiveSessionConfig({ voiceName: "Kore", thinkingLevel: "medium" });
  assert.deepEqual(config.responseModalities, [Modality.AUDIO]);
  assert.equal(config.thinkingConfig?.thinkingLevel, ThinkingLevel.MEDIUM);
  assert.equal(config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName, "Kore");
  assert.equal(config.realtimeInputConfig?.activityHandling, ActivityHandling.NO_INTERRUPTION);
  assert.equal(config.realtimeInputConfig?.automaticActivityDetection?.disabled, false);
  assert.equal(config.realtimeInputConfig?.automaticActivityDetection?.startOfSpeechSensitivity, StartSensitivity.START_SENSITIVITY_LOW);
  assert.equal(config.realtimeInputConfig?.automaticActivityDetection?.endOfSpeechSensitivity, EndSensitivity.END_SENSITIVITY_LOW);
  assert.equal(config.realtimeInputConfig?.automaticActivityDetection?.prefixPaddingMs, 200);
  assert.equal(config.realtimeInputConfig?.automaticActivityDetection?.silenceDurationMs, 650);
  assert.equal(config.realtimeInputConfig?.turnCoverage, TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY);
});
await test("canonical Live config excludes unsupported preview fields", () => {
  const config = buildGeminiLiveSessionConfig({ voiceName: "Kore", thinkingLevel: "medium" }) as Record<string, unknown>;
  assert.equal("proactivity" in config, false);
  assert.equal("enableAffectiveDialog" in config, false);
  assert.equal("explicitVadSignal" in config, false);
});
await test("sanitized configuration assertion contains no secrets or content", () => {
  assert.deepEqual(sanitizedLiveConfigurationAssertion(buildGeminiLiveSessionConfig({ voiceName: "Kore", thinkingLevel: "medium" })), {
    modelConfigured: true,
    audioModalityConfigured: true,
    voiceConfigured: true,
    thinkingLevelConfigured: "medium",
    activityHandlingConfigured: ActivityHandling.NO_INTERRUPTION,
    automaticVadEnabled: true,
    startSensitivityConfigured: "LOW",
    endSensitivityConfigured: "LOW",
    prefixPaddingMs: 200,
    silenceDurationMs: 650,
    turnCoverageConfigured: "ONLY_ACTIVITY"
  });
});
await test("Phase 1A intro state machine reaches ready without microphone", () => {
  let current = initialLiveState;
  current = liveStateReducer(current, { type: "intro_phase", phase: "player_preparing" });
  assert.equal(current.status, "player_preparing");
  assert.equal(current.turnState, "thinking");
  current = liveStateReducer(current, { type: "intro_phase", phase: "intro_playing" });
  assert.equal(current.status, "intro_playing");
  assert.equal(current.turnState, "assistant_speaking");
  current = liveStateReducer(current, { type: "intro_phase", phase: "ready_without_microphone" });
  assert.equal(current.status, "ready_without_microphone");
  assert.equal(current.turnState, "disconnected");
});
await test("Phase 1C raw setup uses Gemini 3.1 Kore audio and medium thinking", () => {
  const setup = buildGeminiLiveIntroSetup({ model: "gemini-3.1-flash-live-preview", voiceName: "Kore", thinkingLevel: "medium" }).setup;
  assert.equal(setup.model, "models/gemini-3.1-flash-live-preview");
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
  assert.equal(setup.generationConfig.thinkingConfig.thinkingLevel, "MEDIUM");
  assert.deepEqual(setup.outputAudioTranscription, {});
  assert.match(setup.systemInstruction.parts[0].text, /not a doctor|must not diagnose|spoken agreement is not permission/i);
  assert.ok(setup.tools?.[0].functionDeclarations.some((tool) => tool.name === "updatePatientStory"));
});
await test("Phase 1A introduction is sent once as realtime input text", () => assert.deepEqual(buildGeminiLiveIntroTextMessage(LIVE_INTRODUCTION), { realtimeInput: { text: LIVE_INTRODUCTION } }));
await test("Phase 1A arms setupComplete wait before sending setup", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  const resolverIndex = hook.indexOf("const waitForSetupComplete = new Promise");
  const sendSetupIndex = hook.indexOf("clientRef.current.sendSetup");
  assert.ok(resolverIndex > -1);
  assert.ok(sendSetupIndex > -1);
  assert.ok(resolverIndex < sendSetupIndex);
});
await test("Phase 1A diagnostics remain available after intro errors", () => {
  const controls = readFileSync(resolve(root, "components/live/LiveAgentControls.tsx"), "utf8");
  assert.match(controls, /state\.status === "error"/);
  assert.match(controls, /Copy voice diagnostics/);
});
await test("Phase 1A parser keeps setup audio transcript and turn markers independent", () => {
  const events = parseGeminiLiveIntroServerMessage({
    setupComplete: {},
    serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAABAA==" } }, { text: "demo" }] },
      outputTranscription: { text: "demo" },
      generationComplete: true,
      turnComplete: true
    }
  }).map((event) => event.type);
  assert.deepEqual(events, ["setup_complete", "generation_complete", "turn_complete", "output_transcript", "audio", "output_text"]);
});
await test("Phase 1A parser recognizes setupComplete raw variants", () => {
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ setupComplete: { sessionId: "redacted" } }), [{ type: "setup_complete" }]);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ setupComplete: true }), [{ type: "setup_complete" }]);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ setup_complete: {} }), [{ type: "setup_complete" }]);
});
await test("Phase 1A parser does not silently ignore setup provider errors or unknown messages", () => {
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ error: { code: 400 } }), [{ type: "provider_error", code: 400, status: undefined, category: "invalid_argument" }]);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ unexpected: {} }), [{ type: "unrecognized_server_message" }]);
});
await test("Phase 1A parser accepts PCM variants and rejects missing data safely", () => {
  assert.equal(isLiveIntroAudioMimeType("audio/pcm"), true);
  assert.equal(isLiveIntroAudioMimeType("audio/pcm;rate=24000"), true);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "" } }] } } }), [{ type: "audio_missing_data", mimeType: "audio/pcm;rate=24000" }]);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/mp3", data: "abc" } }] } } }), [{ type: "unsupported_audio_mime", mimeType: "audio/mp3" }]);
});
await test("Phase 1A normalizes string server frames", async () => {
  const frame = await normalizeGeminiServerFrame("{\"setupComplete\":{}}");
  assert.equal(frame.frameType, "string");
  assert.equal(frame.byteLength, new TextEncoder().encode(frame.text).byteLength);
});
await test("Phase 1A normalizes Blob server frames", async () => {
  const frame = await normalizeGeminiServerFrame(new Blob(["{\"setupComplete\":{}}"]));
  assert.equal(frame.frameType, "blob");
  assert.equal(frame.text, "{\"setupComplete\":{}}");
  assert.equal(frame.byteLength, frame.text.length);
});
await test("Phase 1A normalizes ArrayBuffer server frames", async () => {
  const bytes = new TextEncoder().encode("{\"setupComplete\":{}}");
  const frame = await normalizeGeminiServerFrame(bytes.buffer);
  assert.equal(frame.frameType, "arraybuffer");
  assert.equal(frame.text, "{\"setupComplete\":{}}");
  assert.equal(frame.byteLength, bytes.byteLength);
});
await test("Phase 1A normalizes ArrayBufferView server frames", async () => {
  const bytes = new TextEncoder().encode("xx{\"setupComplete\":{}}yy");
  const view = new Uint8Array(bytes.buffer, 2, bytes.byteLength - 4);
  const frame = await normalizeGeminiServerFrame(view);
  assert.equal(frame.frameType, "arraybuffer_view");
  assert.equal(frame.text, "{\"setupComplete\":{}}");
  assert.equal(frame.byteLength, view.byteLength);
});
await test("Phase 1A rejects unsupported server frame objects", async () => {
  await assert.rejects(() => normalizeGeminiServerFrame({ setupComplete: {} }), /unsupported_server_frame_type/);
});
await test("Phase 1A preserves empty string frame boundary", async () => {
  const frame = await normalizeGeminiServerFrame("");
  const result = parseNormalizedGeminiServerFrame(frame);
  assert.equal(frame.byteLength, 0);
  assert.equal(result.metadata.canonicalKind, "invalid_json");
  assert.equal(result.metadata.jsonParseSucceeded, false);
});
await test("Phase 1A decodes UTF-8 JSON server frames", async () => {
  const bytes = new TextEncoder().encode("{\"serverContent\":{\"modelTurn\":{\"parts\":[{\"text\":\"café\"}]}}}");
  const result = parseNormalizedGeminiServerFrame(await normalizeGeminiServerFrame(bytes));
  assert.equal(result.metadata.jsonParseSucceeded, true);
  assert.equal(result.metadata.canonicalKind, "server_content");
  assert.deepEqual(result.events.map((event) => event.type), ["output_text"]);
});
await test("Phase 1A JSON envelope records valid object roots", () => {
  const result = parseNormalizedGeminiServerFrame({ text: "{\"setupComplete\":{}}", frameType: "string", byteLength: 20 });
  assert.equal(result.metadata.jsonRootType, "object");
  assert.equal(result.metadata.canonicalKind, "setup_complete");
  assert.equal(result.metadata.setupCompletePropertyPresent, true);
});
await test("Phase 1A JSON envelope rejects invalid JSON without raw text", () => {
  const result = parseNormalizedGeminiServerFrame({ text: "{\"token\":\"secret\"", frameType: "string", byteLength: 17 });
  const serialized = JSON.stringify(result.metadata);
  assert.equal(result.metadata.canonicalKind, "invalid_json");
  assert.doesNotMatch(serialized, /secret|token|raw|text/i);
});
await test("Phase 1A JSON envelope rejects array, string, and null roots", () => {
  assert.equal(parseNormalizedGeminiServerFrame({ text: "[]", frameType: "string", byteLength: 2 }).metadata.canonicalKind, "invalid_json_root");
  assert.equal(parseNormalizedGeminiServerFrame({ text: "\"demo\"", frameType: "string", byteLength: 6 }).metadata.jsonRootType, "string");
  assert.equal(parseNormalizedGeminiServerFrame({ text: "null", frameType: "string", byteLength: 4 }).metadata.jsonRootType, "null");
});
await test("Phase 1A setupComplete uses property-presence detection only", () => {
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ setupComplete: {} }), [{ type: "setup_complete" }]);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ setupComplete: true }), [{ type: "setup_complete" }]);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({ setup_complete: {} }), [{ type: "setup_complete" }]);
  assert.equal(classifyGeminiLiveIntroServerMessage({ setupComplete: undefined }).setupCompletePropertyPresent, true);
  assert.deepEqual(parseGeminiLiveIntroServerMessage({}), [{ type: "unrecognized_server_message" }]);
});
await test("Phase 1A first-frame key diagnostics are capped, sanitized, and value-free", () => {
  const result = parseNormalizedGeminiServerFrame({
    text: JSON.stringify({
      "setupComplete": {},
      "bad.key": "token_secret",
      "https://example.test/path?access_token=secret": "ignored",
      "transcript": "user said private phrase",
      "inlineData": "AAECAwQFBgcICQ==",
      "one": 1,
      "two": 2,
      "three": 3,
      "four": 4,
      "five": 5,
      "six": 6,
      "seven": 7,
      "eight": 8
    }),
    frameType: "string",
    byteLength: 1
  });
  const serialized = JSON.stringify(result.metadata);
  assert.equal(result.metadata.topLevelKeys.length, 12);
  assert.ok(result.metadata.topLevelKeys.every((key) => /^[A-Za-z0-9_-]{1,64}$/.test(key)));
  assert.doesNotMatch(serialized, /token_secret|private phrase|AAECAw|access_token=secret|https:\/\//);
});
await test("Phase 1A provider errors are classified without provider messages", () => {
  const result = parseNormalizedGeminiServerFrame({
    text: JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "raw provider detail" } }),
    frameType: "string",
    byteLength: 1
  });
  assert.equal(result.metadata.canonicalKind, "provider_error");
  assert.equal(result.metadata.providerErrorCategory, "invalid_argument");
  assert.equal(result.events[0].type, "provider_error");
  assert.doesNotMatch(JSON.stringify(result.metadata), /raw provider detail/);
});
await test("Phase 1A serialized inbound processing preserves Blob arrival order", async () => {
  class FakeIntroSocket {
    static instances: FakeIntroSocket[] = [];
    onopen?: () => void;
    onmessage?: (event: { data: unknown }) => void;
    onclose?: (event: { code: number; reason: string; wasClean: boolean }) => void;
    readyState = 1;
    constructor(readonly url: string) { FakeIntroSocket.instances.push(this); }
    send() {}
    close() { this.onclose?.({ code: 1000, reason: "", wasClean: true }); }
    open() { this.onopen?.(); }
    emit(data: unknown) { this.onmessage?.({ data }); }
  }
  const received: string[] = [];
  const client = new GeminiLiveIntroClient({
    onMessage: (events) => { received.push(...events.map((event) => event.type)); }
  }, FakeIntroSocket as unknown as typeof WebSocket);
  const connecting = client.connect("redacted-token");
  FakeIntroSocket.instances[0].open();
  await connecting;

  let releaseSlow: () => void = () => undefined;
  const slowBlob = new Blob([""]);
  Object.defineProperty(slowBlob, "text", {
    value: () => new Promise<string>((resolve) => { releaseSlow = () => resolve("{\"setupComplete\":{}}"); })
  });
  const fastBlob = new Blob(["{\"serverContent\":{\"modelTurn\":{\"parts\":[{\"text\":\"demo\"}]}}}"]);
  FakeIntroSocket.instances[0].emit(slowBlob);
  FakeIntroSocket.instances[0].emit(fastBlob);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(received, []);
  releaseSlow();
  await waitForTestCondition(() => received.length === 2);
  assert.deepEqual(received, ["setup_complete", "output_text"]);
});
await test("Phase 1A failed inbound frame does not poison the receive chain", async () => {
  class FakeIntroSocket {
    static instances: FakeIntroSocket[] = [];
    onopen?: () => void;
    onmessage?: (event: { data: unknown }) => void;
    readyState = 1;
    constructor(readonly url: string) { FakeIntroSocket.instances.push(this); }
    send() {}
    close() {}
    open() { this.onopen?.(); }
    emit(data: unknown) { this.onmessage?.({ data }); }
  }
  const received: string[] = [];
  const client = new GeminiLiveIntroClient({
    onMessage: (events) => { received.push(...events.map((event) => event.type)); }
  }, FakeIntroSocket as unknown as typeof WebSocket);
  const connecting = client.connect("redacted-token");
  FakeIntroSocket.instances[0].open();
  await connecting;
  FakeIntroSocket.instances[0].emit({ unsupported: true });
  FakeIntroSocket.instances[0].emit("{\"setupComplete\":{}}");
  await waitForTestCondition(() => received.length === 2);
  assert.deepEqual(received, ["parse_error", "setup_complete"]);
});
await test("Phase 1C gate requires player drain and server turnComplete before cooldown", () => {
  const gate = new LiveOutputTurnGate();
  gate.startOutputTurn(1);
  assert.equal(gate.markPlayerDrained(1), false);
  assert.equal(gate.snapshot().playerDrainedForOutputTurn, true);
  assert.equal(gate.snapshot().serverTurnCompleteReceivedForOutputTurn, false);
  assert.equal(gate.markServerTurnComplete(1), true);
  assert.equal(gate.startCooldown(1), true);
});
await test("Phase 1C gate also waits when turnComplete arrives before drain", () => {
  const gate = new LiveOutputTurnGate();
  gate.startOutputTurn(1);
  assert.equal(gate.markServerTurnComplete(1), false);
  assert.equal(gate.markPlayerDrained(1), true);
  assert.equal(gate.startCooldown(1), true);
});
await test("Phase 1C gate starts only one cooldown for duplicate events", () => {
  const gate = new LiveOutputTurnGate();
  gate.startOutputTurn(1);
  assert.equal(gate.markServerTurnComplete(1), false);
  assert.equal(gate.markPlayerDrained(1), true);
  assert.equal(gate.startCooldown(1), true);
  assert.equal(gate.markServerTurnComplete(1), false);
  assert.equal(gate.markPlayerDrained(1), false);
  assert.equal(gate.startCooldown(1), false);
});
await test("Phase 1C stale output-turn events cannot enable listening", () => {
  const gate = new LiveOutputTurnGate();
  gate.startOutputTurn(1);
  assert.equal(gate.markServerTurnComplete(1), false);
  gate.startOutputTurn(2);
  assert.equal(gate.markPlayerDrained(1), false);
  assert.equal(gate.startCooldown(1), false);
  assert.equal(gate.snapshot().outputTurnId, 2);
});
await test("Phase 1C cooldown timing remains 400 ms", () => assert.equal(phase1CCooldownMs(), 400));
await test("Phase 1C microphone permission alone does not forward PCM", () => {
  assert.deepEqual(canForwardPhase1CMicrophonePcm({ voiceState: "ready_but_blocked", microphonePermissionGranted: true, microphoneEnabled: true, muted: false, stopped: false, modelOutputActive: false, playbackActive: false, cooldownActive: false, completedOneTurn: false }), { allowed: false, reason: "not_listening" });
});
await test("Phase 1C microphone forwards PCM only in listening", () => {
  assert.equal(canForwardPhase1CMicrophonePcm({ voiceState: "listening", microphonePermissionGranted: true, microphoneEnabled: true, muted: false, stopped: false, modelOutputActive: false, playbackActive: false, cooldownActive: false, completedOneTurn: false }).allowed, true);
});
await test("Phase 1C microphone discards during generation playback cooldown mute stop and completion", () => {
  const base = { voiceState: "listening" as const, microphonePermissionGranted: true, microphoneEnabled: true, muted: false, stopped: false, modelOutputActive: false, playbackActive: false, cooldownActive: false, completedOneTurn: false };
  assert.equal(canForwardPhase1CMicrophonePcm({ ...base, modelOutputActive: true }).reason, "model_output_active");
  assert.equal(canForwardPhase1CMicrophonePcm({ ...base, playbackActive: true }).reason, "playback_active");
  assert.equal(canForwardPhase1CMicrophonePcm({ ...base, cooldownActive: true }).reason, "cooldown_active");
  assert.equal(canForwardPhase1CMicrophonePcm({ ...base, muted: true }).reason, "muted");
  assert.equal(canForwardPhase1CMicrophonePcm({ ...base, stopped: true }).reason, "stopped");
  assert.equal(canForwardPhase1CMicrophonePcm({ ...base, completedOneTurn: true }).reason, "completed_one_turn");
});
await test("Phase 1C microphone encoder records transmitted 16 kHz chunks", () => {
  const encoder = new LiveMicrophonePcmEncoder();
  const chunks = encoder.encode(new Float32Array(960).fill(0.25), 48_000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sampleRate, 16_000);
  assert.equal(chunks[0].byteLength, 640);
});
await test("Phase 1C microphone encoder preserves mono PCM16 little-endian format", () => {
  const encoder = new LiveMicrophonePcmEncoder();
  const chunks = encoder.encode(new Float32Array(320).fill(-1), 16_000);
  const binary = atob(chunks[0].data);
  assert.equal(binary.charCodeAt(0), 0);
  assert.equal(binary.charCodeAt(1), 128);
});
await test("Phase 1C microphone diagnostics contain no raw PCM or Base64", () => {
  const diagnostics = createLiveIntroDiagnostics();
  const serialized = JSON.stringify(diagnostics);
  assert.match(serialized, /microphoneForwardedChunkCount/);
  assert.doesNotMatch(serialized, /pcm|base64|transcript|prompt|patient/i);
});
await test("Phase 1C hook requires both output gates before listening and cancels cooldown on cleanup", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /markServerTurnCompleteForCurrentOutput/);
  assert.match(hook, /markPlayerDrained\(drainingTurnId\)/);
  assert.match(hook, /setTimeout\(\(\) => \{[\s\S]*phase1CCooldownMs\(\)/);
  assert.match(hook, /cancelCooldown\(\)/);
  assert.match(hook, /listening_started_before_server_turn_complete/);
  assert.match(hook, /listening_started_before_player_drain/);
  assert.match(hook, /listening_started_before_cooldown_complete/);
});
await test("Phase 1C hook does not collapse player drain failures into microphone-turn failures", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /fail\(boundary\)/);
  assert.doesNotMatch(hook, /player_failed_after_microphone_turn" : boundary/);
});
await test("Phase 1C hook labels non-introduction audio as output segments, not intro phase", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /currentOutputSegmentKind === "introduction"/);
  assert.match(hook, /currentOutputSegmentStatus: "playing"/);
  assert.match(hook, /dispatch\(\{ type: "speak" \}\)/);
});
await test("Phase 1C hook starts microphone capture but blocks forwarding until listening", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /new LiveMicrophoneCapture\(processMicrophoneFrame\)/);
  assert.match(hook, /publishMicrophoneGate\("ready_but_blocked", "not_listening"\)/);
  assert.match(hook, /canForwardPhase1CMicrophonePcm/);
});
await test("Phase 1C hook sends accurate audio MIME through raw client", () => {
  const client = readFileSync(resolve(root, "lib/live/liveIntroClient.ts"), "utf8");
  assert.match(client, /mimeType: `audio\/pcm;rate=\$\{sampleRate\}`/);
  assert.match(client, /audioStreamEnd/);
});
await test("Phase 1C one-turn completion prevents an automatic second listening turn", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /completePhase1COneTurn/);
  assert.match(hook, /completedOneTurnRef\.current = true/);
  assert.match(hook, /clientRef\.current\?\.close\("session_complete"\)/);
  assert.doesNotMatch(hook, /completedOneTurnRef\.current[\s\S]{0,200}publishMicrophoneGate\("listening"/);
});
await test("Phase 1C Stop Sema cleans microphone capture and does not repeat introduction", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /microphoneCaptureRef\.current\?\.stop\(\)/);
  assert.match(hook, /clientRef\.current\?\.close\(closeReason\)/);
  assert.match(hook, /cleanup\("user_stop"\)/);
  assert.doesNotMatch(hook.match(/function stopSema\(\)[\s\S]*?}\n/)?.[0] ?? "", /sendIntro|startIntroOnlySession/);
});
await test("Phase 1A PCM decoder uses little-endian signed 16-bit samples", () => {
  const samples = decodeBase64Pcm16LittleEndian("AAAAgP//");
  assert.deepEqual(Array.from(samples).map((value) => Number(value.toFixed(5))), [0, -1, -0.00003]);
});
await test("Phase 1C player watchdog treats long scheduled output as healthy at ten seconds", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "running",
      audioContextCurrentTime: 10,
      nextStartTime: 20,
      latestScheduledEndTime: 20,
      expectedRemainingPlaybackMs: 10_000,
      decodedAudioChunkCount: 132,
      decodedSampleCount: 480_000,
      scheduledSourceCount: 132,
      startedSourceCount: 132,
      sourceStartCallCount: 132,
      endedSourceCount: 85,
      activeOutputSourceCount: 47,
      sourceEndProgressCount: 85,
      playerState: "draining"
    },
    lastAudioContextCurrentTime: 0,
    lastEndedSourceCount: 84,
    graceMs: LIVE_PLAYER_DRAIN_GRACE_MS
  });
  assert.deepEqual(decision, { status: "healthy", progressObserved: true });
});
await test("Phase 1C player watchdog lets five-second output drain normally", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "running",
      audioContextCurrentTime: 5.1,
      nextStartTime: 5,
      latestScheduledEndTime: 5,
      expectedRemainingPlaybackMs: 0,
      decodedAudioChunkCount: 20,
      decodedSampleCount: 120_000,
      scheduledSourceCount: 20,
      startedSourceCount: 20,
      sourceStartCallCount: 20,
      endedSourceCount: 20,
      activeOutputSourceCount: 0,
      sourceEndProgressCount: 20,
      playerState: "idle"
    },
    lastAudioContextCurrentTime: 4.9,
    lastEndedSourceCount: 19
  });
  assert.deepEqual(decision, { status: "drained" });
});
await test("Phase 1C player watchdog supports very long scheduled output without a fixed ten-second cutoff", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "running",
      audioContextCurrentTime: 10,
      nextStartTime: 45,
      latestScheduledEndTime: 45,
      expectedRemainingPlaybackMs: 35_000,
      decodedAudioChunkCount: 260,
      decodedSampleCount: 1_080_000,
      scheduledSourceCount: 260,
      startedSourceCount: 260,
      sourceStartCallCount: 260,
      endedSourceCount: 40,
      activeOutputSourceCount: 220,
      sourceEndProgressCount: 40,
      playerState: "draining"
    },
    lastAudioContextCurrentTime: 5,
    lastEndedSourceCount: 39
  });
  assert.equal(decision.status, "healthy");
});
await test("Phase 1C player watchdog stays healthy while source-end progress continues through long playback", () => {
  for (const sample of [
    { currentTime: 8, ended: 20, remainingMs: 37_000 },
    { currentTime: 18, ended: 80, remainingMs: 27_000 },
    { currentTime: 34, ended: 190, remainingMs: 11_000 }
  ]) {
    const decision = evaluateLivePcmDrainWatchdog({
      stats: {
        audioContextState: "running",
        audioContextCurrentTime: sample.currentTime,
        nextStartTime: 45,
        latestScheduledEndTime: 45,
        expectedRemainingPlaybackMs: sample.remainingMs,
        decodedAudioChunkCount: 260,
        decodedSampleCount: 1_080_000,
        scheduledSourceCount: 260,
        startedSourceCount: 260,
        sourceStartCallCount: 260,
        endedSourceCount: sample.ended,
        activeOutputSourceCount: 260 - sample.ended,
        sourceEndProgressCount: sample.ended,
        playerState: "draining"
      },
      lastAudioContextCurrentTime: sample.currentTime - 1,
      lastEndedSourceCount: sample.ended - 1
    });
    assert.deepEqual(decision, { status: "healthy", progressObserved: true });
  }
});
await test("Phase 1C generationComplete can arrive long before local drain", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "running",
      audioContextCurrentTime: 12,
      nextStartTime: 30,
      latestScheduledEndTime: 30,
      expectedRemainingPlaybackMs: 18_000,
      decodedAudioChunkCount: 180,
      decodedSampleCount: 720_000,
      scheduledSourceCount: 180,
      startedSourceCount: 180,
      sourceStartCallCount: 180,
      endedSourceCount: 65,
      activeOutputSourceCount: 115,
      sourceEndProgressCount: 65,
      playerState: "draining"
    },
    lastAudioContextCurrentTime: 10,
    lastEndedSourceCount: 64
  });
  assert.deepEqual(decision, { status: "healthy", progressObserved: true });
});
await test("Phase 1C player watchdog classifies real source-end stalls after expected end", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "running",
      audioContextCurrentTime: 23,
      nextStartTime: 20,
      latestScheduledEndTime: 20,
      expectedRemainingPlaybackMs: 0,
      decodedAudioChunkCount: 2,
      decodedSampleCount: 48_000,
      scheduledSourceCount: 2,
      startedSourceCount: 2,
      sourceStartCallCount: 2,
      endedSourceCount: 1,
      activeOutputSourceCount: 1,
      sourceEndProgressCount: 1,
      playerState: "draining"
    },
    lastAudioContextCurrentTime: 22,
    lastEndedSourceCount: 1,
    graceMs: LIVE_PLAYER_DRAIN_GRACE_MS
  });
  assert.deepEqual(decision, { status: "failed", boundary: "source_end_stalled_after_expected_end" });
});
await test("Phase 1C player watchdog classifies a stuck AudioContext clock separately", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "running",
      audioContextCurrentTime: 5,
      nextStartTime: 20,
      latestScheduledEndTime: 20,
      expectedRemainingPlaybackMs: 15_000,
      decodedAudioChunkCount: 2,
      decodedSampleCount: 48_000,
      scheduledSourceCount: 2,
      startedSourceCount: 2,
      sourceStartCallCount: 2,
      endedSourceCount: 0,
      activeOutputSourceCount: 2,
      sourceEndProgressCount: 0,
      playerState: "draining"
    },
    lastAudioContextCurrentTime: 5,
    lastEndedSourceCount: 0
  });
  assert.deepEqual(decision, { status: "failed", boundary: "audio_context_clock_not_advancing" });
});
await test("Phase 1C player watchdog does not immediately fail suspended AudioContext", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "suspended",
      audioContextCurrentTime: 4,
      nextStartTime: 10,
      latestScheduledEndTime: 10,
      expectedRemainingPlaybackMs: 6_000,
      decodedAudioChunkCount: 4,
      decodedSampleCount: 96_000,
      scheduledSourceCount: 4,
      startedSourceCount: 4,
      sourceStartCallCount: 4,
      endedSourceCount: 1,
      activeOutputSourceCount: 3,
      sourceEndProgressCount: 1,
      playerState: "draining"
    },
    lastAudioContextCurrentTime: 4,
    lastEndedSourceCount: 1
  });
  assert.deepEqual(decision, { status: "healthy", progressObserved: false });
});
await test("Phase 1C player watchdog classifies closed AudioContext", () => {
  const decision = evaluateLivePcmDrainWatchdog({
    stats: {
      audioContextState: "closed",
      audioContextCurrentTime: 4,
      nextStartTime: 10,
      latestScheduledEndTime: 10,
      expectedRemainingPlaybackMs: 6_000,
      decodedAudioChunkCount: 4,
      decodedSampleCount: 96_000,
      scheduledSourceCount: 4,
      startedSourceCount: 4,
      sourceStartCallCount: 4,
      endedSourceCount: 1,
      activeOutputSourceCount: 3,
      sourceEndProgressCount: 1,
      playerState: "draining"
    },
    lastAudioContextCurrentTime: 4,
    lastEndedSourceCount: 1
  });
  assert.deepEqual(decision, { status: "failed", boundary: "audio_context_closed_unexpectedly" });
});
await test("Phase 1C player drain deadline is scheduled-duration aware", () => {
  const player = readFileSync(resolve(root, "lib/live/livePcmOutputPlayer.ts"), "utf8");
  assert.doesNotMatch(player, /waitForDrain\(timeoutMs = 10_000\)/);
  assert.match(player, /expectedRemainingPlaybackMs \+ waiter\.graceMs/);
  assert.match(player, /latestScheduledEndTime/);
  assert.match(player, /sourceEndProgressCount/);
  assert.match(player, /sourceStartCallCount/);
});
await test("Phase 1C queue extension re-arms and invalidates the prior drain timer", () => {
  const player = readFileSync(resolve(root, "lib/live/livePcmOutputPlayer.ts"), "utf8");
  assert.match(player, /if \(waiter\.timer\) clearTimeout\(waiter\.timer\)/);
  assert.match(player, /this\.rearmDrainWaiters\(\)/);
  assert.match(player, /latestScheduledEndTime = Math\.max/);
  assert.match(player, /expectedRemainingPlaybackMs \+ waiter\.graceMs/);
});
await test("Phase 1C new PCM shortly before an old deadline extends the watched schedule", () => {
  const player = readFileSync(resolve(root, "lib/live/livePcmOutputPlayer.ts"), "utf8");
  assert.match(player, /enqueueBase64Pcm/);
  assert.match(player, /this\.stats\.latestScheduledEndTime = Math\.max\(this\.stats\.latestScheduledEndTime \?\? endAt, endAt\)/);
  assert.match(player, /this\.rearmDrainWaiters\(\)/);
});
await test("Phase 1C hook scopes stale watchdogs by connection interaction segment and generation", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /drainingConnectionGeneration === connectionGenerationRef\.current/);
  assert.match(hook, /drainingInteractionId === diagnosticsRef\.current\.currentInteractionId/);
  assert.match(hook, /drainingTurnId === outputTurnIdRef\.current/);
  assert.match(hook, /drainingWatchdogGeneration === playerWatchdogGenerationRef\.current/);
  assert.match(hook, /currentOutputSegmentId === drainingTurnId/);
});
await test("Phase 1C stale segment and connection watchdog callbacks return without failing", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /if \(!isCurrentDrainWatchdog\(\)\) return;[\s\S]*drainingRef\.current = false/);
  assert.match(hook, /if \(!isCurrentDrainWatchdog\(\)\) return;[\s\S]*const boundary = error instanceof LivePcmOutputError/);
  assert.doesNotMatch(hook, /player_failed_after_microphone_turn" : boundary/);
});
await test("Phase 1C intentional End and component cleanup invalidate player watchdogs", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /const cleanup = useCallback/);
  assert.match(hook, /stoppedRef\.current = true;[\s\S]*playerWatchdogGenerationRef\.current \+= 1/);
  assert.match(hook, /function end\(\) \{ cleanup\("user_stop"\)/);
  assert.match(hook, /playerRef\.current\?\.close\(\)/);
});
await test("Phase 1C preview diagnostics include watchdog generation segment and stall counters", () => {
  const controls = readFileSync(resolve(root, "lib/live/liveIntroControl.ts"), "utf8");
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  for (const field of ["latestScheduledEndAudioTime", "playerWatchdogGeneration", "playerWatchdogSegmentId", "truePlayerStallCount", "falsePlayerTimeoutCount"]) {
    assert.match(controls + hook, new RegExp(field));
  }
  assert.match(hook, /falsePlayerTimeoutCount/);
  assert.match(hook, /truePlayerStallCount: diagnosticsRef\.current\.truePlayerStallCount \+ 1/);
});
await test("Phase 1A diagnostics contain counters and no sensitive payload fields", () => {
  const diagnostics = createLiveIntroDiagnostics();
  const text = JSON.stringify(diagnostics);
  assert.match(text, /audioPartCount/);
  assert.doesNotMatch(text, /token|prompt|transcript|base64|pcm|key|url|patient|packet|photo/i);
});
await test("hook uses explicit page-memory introduction state", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /useState<"not_started"/);
  assert.match(hook, /phaseToIntroductionState/);
  assert.match(hook, /ready_without_microphone/);
  assert.doesNotMatch(hook, /sessionStorage\.setItem\("sema-live-intro-delivered"/);
});
await test("introduction is not recorded as patient input", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /sendIntro\(LIVE_INTRODUCTION\)/);
  assert.doesNotMatch(hook, /transcriptLine\("user", LIVE_INTRODUCTION/);
});
await test("Phase 1C hook requests microphone only after disclosure and gates forwarding", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /new LiveMicrophoneCapture\(processMicrophoneFrame\)/);
  assert.match(hook, /canForwardPhase1CMicrophonePcm/);
  assert.match(hook, /setMicrophoneMuted/);
  assert.doesNotMatch(hook, /createScriptProcessor/);
});
await test("Phase 1C.1 presentation reports speaking while output is active", () => {
  const presentation = livePresentation(
    { status: "intro_playing", turnState: "assistant_speaking", outputState: "playing" },
    { activeOutputSourceCount: 1, outputTurnId: 1, microphonePermissionGranted: true, microphoneStreamCreated: true, microphoneForwardingBlocked: true, cooldownActive: false }
  );
  assert.equal(presentation.statusKey, "speaking");
  assert.equal(presentation.badgeLabel, "Sema is speaking");
  assert.equal(presentation.detailLabel, "Sema is speaking. Your microphone is not being forwarded.");
  assert.equal(presentation.microphoneForwardingAllowed, false);
  assert.equal(presentation.microphoneIndicator, "blocked");
  assert.equal(presentation.statusInvariantPassed, true);
});
await test("Phase 1C.1 presentation reports finishing response during drain", () => {
  const presentation = livePresentation(
    { status: "intro_drained", turnState: "draining", outputState: "idle" },
    { activeOutputSourceCount: 0, outputTurnId: 1, serverTurnCompleteReceivedForOutputTurn: true, playerDrainedForOutputTurn: true }
  );
  assert.equal(presentation.statusKey, "finishing_output");
  assert.equal(presentation.badgeLabel, "Finishing response");
  assert.equal(presentation.detailLabel, "Sema is finishing the current response. Your microphone is not being forwarded.");
  assert.equal(presentation.microphoneForwardingAllowed, false);
});
await test("Phase 1C.1 presentation reports cooldown before listening", () => {
  const presentation = livePresentation(
    { status: "intro_drained", turnState: "post_playback_cooldown", outputState: "idle" },
    { cooldownActive: true, activeOutputSourceCount: 0, microphoneForwardingBlocked: true }
  );
  assert.equal(presentation.statusKey, "cooldown");
  assert.equal(presentation.badgeLabel, "Getting ready to listen");
  assert.equal(presentation.detailLabel, "Sema will listen after the short transition completes.");
  assert.equal(presentation.microphoneForwardingAllowed, false);
});
await test("Phase 1C.1 presentation reports listening only when the microphone gate allows forwarding", () => {
  const presentation = livePresentation(
    { status: "listening", turnState: "listening", outputState: "idle" },
    { microphonePermissionGranted: true, microphoneStreamCreated: true, microphoneForwardingBlocked: false, microphoneMuted: false, cooldownActive: false, activeOutputSourceCount: 0, completedOneTurn: false }
  );
  assert.equal(presentation.statusKey, "listening");
  assert.equal(presentation.badgeLabel, "Sema is listening");
  assert.equal(presentation.detailLabel, "Speak now. Microphone audio is being forwarded only for this listening turn.");
  assert.equal(presentation.microphoneForwardingAllowed, true);
  assert.equal(presentation.microphoneIndicator, "listening");
  assert.equal(presentation.statusInvariantPassed, true);
});
await test("Phase 1C.1 presentation does not claim listening when forwarding is blocked", () => {
  const presentation = livePresentation(
    { status: "listening", turnState: "listening", outputState: "idle" },
    { microphonePermissionGranted: true, microphoneStreamCreated: true, microphoneForwardingBlocked: true, microphoneBlockReason: "not_listening", activeOutputSourceCount: 0 }
  );
  assert.notEqual(presentation.statusKey, "listening");
  assert.equal(presentation.microphoneForwardingAllowed, false);
});
await test("Phase 1C.1 presentation reports processing after the user turn ends", () => {
  const presentation = livePresentation(
    { status: "thinking", turnState: "thinking", outputState: "idle" },
    { microphonePermissionGranted: true, microphoneStreamCreated: true, microphoneForwardingBlocked: true, microphoneBlockReason: "model_output_active" }
  );
  assert.equal(presentation.statusKey, "processing");
  assert.equal(presentation.badgeLabel, "Sema is responding");
  assert.equal(presentation.detailLabel, "Your listening turn has ended. Microphone audio is no longer being forwarded.");
});
await test("Phase 1C.1 presentation reports completed without stale speaking or listening text", () => {
  const presentation = livePresentation(
    { status: "completed_one_turn", turnState: "disconnected", outputState: "idle" },
    { completedOneTurn: true, activeOutputSourceCount: 0 }
  );
  assert.equal(presentation.statusKey, "completed");
  assert.equal(presentation.badgeLabel, "Voice check complete");
  assert.equal(presentation.detailLabel, "One spoken turn and one Sema response completed successfully.");
  assert.doesNotMatch(`${presentation.badgeLabel} ${presentation.detailLabel}`, /speaking|listening/i);
});
await test("Phase 1C.1 status invariant catches mismatched visible listening and forwarding", () => {
  assert.equal(liveVoiceStatusInvariant({ userVisibleStatusKey: "listening", microphoneForwardingAllowed: false, activeOutputSourceCount: 0, outputTurnActive: false, completed: false }), false);
  assert.equal(liveVoiceStatusInvariant({ userVisibleStatusKey: "speaking", microphoneForwardingAllowed: true, activeOutputSourceCount: 1, outputTurnActive: true, completed: false }), false);
  assert.equal(liveVoiceStatusInvariant({ userVisibleStatusKey: "completed", microphoneForwardingAllowed: false, activeOutputSourceCount: 0, outputTurnActive: false, completed: true }), true);
});
await test("Phase 1C.1 diagnostics expose sanitized UI state keys only", () => {
  const diagnostics = createLiveIntroDiagnostics();
  const presentation = liveVoicePresentationForState(initialLiveState, diagnostics);
  const serialized = JSON.stringify({
    authoritativeVoiceState: `${initialLiveState.status}:${initialLiveState.turnState}:${initialLiveState.outputState}`,
    userVisibleStatusKey: presentation.statusKey,
    userVisibleBadgeLabelKey: presentation.badgeLabelKey,
    microphoneForwardingAllowed: presentation.microphoneForwardingAllowed,
    microphoneIndicatorState: presentation.microphoneIndicator,
    activeOutputSourceCount: diagnostics.activeOutputSourceCount ?? 0,
    cooldownActive: diagnostics.cooldownActive ?? false,
    statusInvariantPassed: presentation.statusInvariantPassed
  });
  assert.match(serialized, /userVisibleStatusKey/);
  assert.doesNotMatch(serialized, /Sema is speaking|Speak now|patient|transcript|base64|token|secret|api/i);
});
await test("Live UI exposes End and microphone mute without a misleading Stop Sema control", () => {
  const controls = readFileSync(resolve(root, "components/live/LiveAgentControls.tsx"), "utf8");
  assert.match(controls, /Mute microphone/);
  assert.match(controls, /End/);
  assert.doesNotMatch(controls, /Stop Sema/);
});
await test("Phase 1C.1 Live UI renders one badge and one detail from the presentation mapping", () => {
  const controls = readFileSync(resolve(root, "components/live/LiveAgentControls.tsx"), "utf8");
  assert.match(controls, /voicePresentation\.badgeLabel/);
  assert.match(controls, /voicePresentation\.detailLabel/);
  assert.doesNotMatch(controls, /statusLabels|outputLabels|introductionLabels|introductionLabel/);
  assert.doesNotMatch(controls, /Sema is speaking/);
  assert.match(controls, /multi-turn conversation/);
});
await test("Gemini Live provider disables voice interruption", () => assert.match(readFileSync(resolve(root, "lib/live/liveSessionConfig.ts"), "utf8"), /ActivityHandling\.NO_INTERRUPTION/));
await test("Live tool calls use canonical validation and the existing action layer", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /toolCallCount/);
  assert.match(hook, /validateLiveToolCall/);
  assert.match(hook, /executeRef\.current/);
  assert.match(hook, /sendToolResponse/);
});
await test("cleanup closes intro client output player and microphone capture", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /clientRef\.current\?\.close\(closeReason\)/);
  assert.match(hook, /playerRef\.current\?\.close\(\)/);
  assert.match(hook, /microphoneCaptureRef\.current\?\.stop\(\)/);
  assert.match(readFileSync(resolve(root, "lib/live/liveMicrophoneCapture.ts"), "utf8"), /getTracks\(\)/);
});
await test("interrupt advances generation", () => assert.equal(liveStateReducer(initialLiveState, { type: "interrupt" }).activeGeneration, 1));
await test("interrupt has a visible state", () => assert.equal(liveStateReducer(initialLiveState, { type: "interrupt" }).status, "interrupted"));
await test("only one reconnect is countable", () => assert.equal(liveStateReducer(initialLiveState, { type: "reconnect" }).reconnectAttempts, 1));
await test("transcript is bounded", () => {
  let current = initialLiveState;
  for (let i = 0; i < 45; i += 1) current = liveStateReducer(current, { type: "transcript", line: { id: String(i), role: "user", text: String(i), final: true } });
  assert.equal(current.transcript.length, 40);
});
await test("transcript clears from memory", () => {
  const withLine = liveStateReducer(initialLiveState, { type: "transcript", line: { id: "1", role: "user", text: "demo", final: true } });
  assert.equal(liveStateReducer(withLine, { type: "clear_transcript" }).transcript.length, 0);
});
await test("identical final transcript updates replace partial duplicates", () => {
  const partial = liveStateReducer(initialLiveState, { type: "transcript", line: { id: "partial", role: "sema", text: "Ready.", final: false } });
  const final = liveStateReducer(partial, { type: "transcript", line: { id: "final", role: "sema", text: "Ready.", final: true } });
  assert.equal(final.transcript.length, 1);
  assert.equal(final.transcript[0].final, true);
});

await test("all required approved Live tools are declared", () => {
  for (const name of ["readCurrentPage", "explainCurrentStep", "readSafetyNote", "readPacketSection", "listMissingFields", "navigateToStory", "navigateToBodyMap", "navigateToAudio", "navigateToMotionVisual", "navigateToPacket", "updatePatientStory", "generateEvidenceSummary", "preparePacketDraft"] as const) {
    assert.ok(LIVE_TOOL_NAMES.includes(name));
  }
  assert.deepEqual(LIVE_TOOL_NAMES.filter((name) => /photo/i.test(name)), ["openPhotoCapture", "readPhotoObservation"]);
});
await test("tool declarations do not expose trusted risk", async () => {
  const declarations = (await import("../liveTools")).LIVE_FUNCTION_DECLARATIONS;
  assert.equal(JSON.stringify(declarations).includes("riskLevel"), false);
});
await test("Live tools use the token-compatible OpenAPI parameter shape", async () => {
  const declarations = (await import("../liveTools")).LIVE_FUNCTION_DECLARATIONS;
  assert.equal(declarations.every((declaration) => declaration.parameters && !declaration.parametersJsonSchema), true);
});
await test("navigation tool validates", () => {
  const value = validateLiveToolCall({ id: "1", name: "openSignalFolder", args: { folderId: "audio" } }, session);
  assert.equal(value.ok && value.action.payload?.folder, "audio");
});
await test("folder overview navigation validates without parameters", () => {
  const value = validateLiveToolCall({ id: "overview", name: "showSignalFolderOverview", args: {} }, session);
  assert.equal(value.ok && value.action.type, "showSignalFolderOverview");
  assert.equal(value.ok && value.permissionRequired, false);
});
await test("unknown tool is rejected", () => assert.equal(validateLiveToolCall({ id: "1", name: "clearSession", args: {} }, session).ok, false));
await test("unexpected parameters are rejected", () => assert.equal(validateLiveToolCall({ id: "1", name: "readCurrentPage", args: { secret: true } }, session).ok, false));
await test("model-supplied risk is rejected", () => assert.equal(validateLiveToolCall({ id: "1", name: "openSignalFolder", args: { folderId: "story", riskLevel: "read_only" } }, session).ok, false));
await test("write tool requires permission", () => {
  const value = validateLiveToolCall({ id: "1", name: "generateStorySummary", args: {} }, approved);
  assert.equal(value.ok && value.permissionRequired, true);
});
await test("verbal confirmation cannot execute a write", () => {
  const value = validateLiveToolCall({ id: "1", name: "prepareEvidencePacket", args: {} }, packetReadyApproved);
  assert.equal(value.ok && value.permissionRequired, true);
  assert.equal(packetReadyApproved.packetDraft, undefined);
});
await test("summary is ineligible without story", () => assert.equal(validateLiveToolCall({ id: "1", name: "generateStorySummary", args: {} }, session).ok, false));
await test("packet is ineligible before approval", () => assert.equal(validateLiveToolCall({ id: "1", name: "prepareEvidencePacket", args: {} }, { ...session, story: { rawText: "demo" } }).ok, false));
await test("packet is eligible after approval and readiness", () => assert.equal(validateLiveToolCall({ id: "1", name: "prepareEvidencePacket", args: {} }, packetReadyApproved).ok, true));
await test("packet section requires packet", () => assert.equal(validateLiveToolCall({ id: "1", name: "readPacketSection", args: { section: "safety" } }, approved).ok, false));
await test("Live PDF export requires a prepared packet", () => assert.equal(validateLiveToolCall({ id: "1", name: "exportPacketPdf", args: {} }, approved).ok, false));
await test("Live PDF export requires visible confirmation", () => {
  const withPacket = { ...approved, packetDraft: buildEvidencePacket(approved) };
  const value = validateLiveToolCall({ id: "1", name: "exportPacketPdf", args: {} }, withPacket);
  assert.equal(value.ok && value.permissionRequired, true);
});
await test("voice review cannot start microphone", () => {
  const value = validateLiveToolCall({ id: "1", name: "openVoiceDraftReview", args: { target: "audio" } }, session);
  assert.equal(value.ok && value.action.type, "openVoiceDraftReview");
});

await test("context excludes raw patient words", () => assert.equal(JSON.stringify(buildLiveSessionContext(approved)).includes("Patient-provided demo story"), false));
await test("context is compact application context, not evidence", () => {
  const context = buildLiveSessionContext(approved);
  assert.equal(context.contextKind, "application_context_not_patient_evidence");
  assert.equal(context.counts.bodyObservations, 0);
  assert.ok(["not_ready", "partially_ready", "ready_to_prepare", "draft_needs_review", "approved"].includes(context.packetStatus));
  assert.equal("approvedStory" in context, false);
});
await test("context delta omits unchanged values", () => {
  const context = buildLiveSessionContext(approved);
  assert.equal(diffLiveSessionContext(context, context), "");
});
await test("context delta includes folder changes", () => {
  const before = buildLiveSessionContext(approved);
  const after = buildLiveSessionContext({ ...approved, activeFolder: "audio" });
  assert.match(diffLiveSessionContext(before, after), /activeFolder/);
});
await test("Live transcript never enters SemaSession", () => {
  const changed = liveStateReducer(initialLiveState, { type: "transcript", line: { id: "t", role: "user", text: "memory only", final: true } });
  assert.equal(JSON.stringify(session).includes("memory only"), false);
  assert.equal(changed.transcript[0].text, "memory only");
});

await test("diagnosis request is blocked", () => assert.equal(screenLiveInput("What disease do I have?").safe, false));
await test("triage request is blocked", () => assert.equal(screenLiveInput("Should I go to the ER?").safe, false));
await test("audio classification is blocked", () => assert.equal(screenLiveInput("Does this cough sound like pneumonia?").safe, false));
await test("neutral organization request is allowed", () => assert.equal(screenLiveInput("What details are missing?").safe, true));
await test("unsafe model treatment output is blocked", () => assert.equal(screenLiveOutput("You should start a medication.").safe, false));
await test("neutral model output is allowed", () => assert.equal(screenLiveOutput("I can organize those observations.").safe, true));

await test("PCM16 is little-endian", () => assert.deepEqual([...float32ToPcm16(new Float32Array([1]))], [255, 127]));
await test("resampling lowers sample count", () => assert.equal(resampleFloat32(new Float32Array(48), 48_000, 16_000).length, 16));
await test("microphone transport batches twenty-millisecond PCM chunks", () => {
  assert.equal(LIVE_INPUT_CHUNK_BYTES, 640);
  const chunker = new PcmChunkAccumulator();
  assert.equal(chunker.push(new Uint8Array(200)).length, 0);
  const chunks = chunker.push(new Uint8Array(1080));
  assert.deepEqual(chunks.map((chunk) => chunk.byteLength), [640, 640]);
  assert.equal(chunker.size, 0);
});
await test("microphone chunk remainder can be flushed", () => {
  const chunker = new PcmChunkAccumulator();
  chunker.push(new Uint8Array(123));
  assert.equal(chunker.flush().byteLength, 123);
  assert.equal(chunker.size, 0);
});
await test("playback cannot report listening before generation completes", () => assert.equal(canCompleteLivePlayback(false, 0, 0), false));
await test("playback cannot report listening while audio scheduling is pending", () => assert.equal(canCompleteLivePlayback(true, 1, 0), false));
await test("playback cannot report listening while a source is active", () => assert.equal(canCompleteLivePlayback(true, 0, 1), false));
await test("playback reports listening only after generation and audio drain", () => assert.equal(canCompleteLivePlayback(true, 0, 0), true));
await test("ordered queue drops interrupted generation", () => {
  const queue = new OrderedPcmQueue<string>(); queue.enqueue(0, "old"); queue.enqueue(1, "new");
  assert.equal(queue.shift(1), "new");
});
await test("ordered queue clears", () => { const queue = new OrderedPcmQueue<string>(); queue.enqueue(0, "x"); queue.clear(); assert.equal(queue.size, 0); });
await test("completed session content survives interruption", () => {
  liveStateReducer(initialLiveState, { type: "interrupt" });
  assert.equal(approved.story.summaryStatus, "approved");
});
await test("one server event with two audio parts queues both in order", () => {
  const value = normalizeGeminiLiveServerEvent({ serverContent: { modelTurn: { parts: [
    { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } },
    { inlineData: { data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" } }
  ] } } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.deepEqual(value.audioChunks.map((chunk) => [chunk.data, chunk.partIndex]), [["AAAA", 0], ["AQIDBA==", 1]]);
});
await test("top-level audio duplicate of inlineData is queued once", () => {
  const value = normalizeGeminiLiveServerEvent({
    data: "AAAA",
    serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] } }
  }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.deepEqual(value.audioChunks.map((chunk) => [chunk.data, chunk.partIndex]), [["AAAA", 0]]);
});
await test("one server event with transcript and audio processes both", () => {
  const value = normalizeGeminiLiveServerEvent({ data: "AAAA", serverContent: { outputTranscription: { text: "hello" }, turnComplete: true } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.equal(value.audioChunks.length, 1);
  assert.equal(value.outputTranscript, "hello");
  assert.equal(value.turnComplete, true);
});
await test("one server event with text and audio processes both", () => {
  const value = normalizeGeminiLiveServerEvent({ serverContent: { modelTurn: { parts: [{ text: "visible" }, { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] } } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.deepEqual(value.textParts.map((part) => part.text), ["visible"]);
  assert.deepEqual(value.audioChunks.map((chunk) => chunk.partIndex), [1]);
});
await test("one server event with tool call and audio processes both", () => {
  const value = normalizeGeminiLiveServerEvent({ serverContent: { modelTurn: { parts: [{ functionCall: { id: "tool-1", name: "readCurrentPage", args: {} } }, { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] } } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.equal(value.toolCalls.length, 1);
  assert.equal(value.audioChunks.length, 1);
});
await test("one server event with multiple tool calls processes each once", () => {
  const value = normalizeGeminiLiveServerEvent({ toolCall: { functionCalls: [{ id: "a", name: "readCurrentPage", args: {} }, { id: "b", name: "readSafetyNote", args: {} }] } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.deepEqual(value.toolCalls.map((call) => call.id), ["a", "b"]);
});
await test("malformed audio does not suppress valid later parts", () => {
  const value = normalizeGeminiLiveServerEvent({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "not-base64!", mimeType: "audio/pcm;rate=24000" } }, { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] } } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.deepEqual(value.audioChunks.map((chunk) => chunk.partIndex), [1]);
});
await test("unsupported binary part does not become PCM", () => {
  assert.equal(isLiveAudioMimeType("image/png"), false);
  const value = normalizeGeminiLiveServerEvent({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "image/png" } }] } } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.equal(value.audioChunks.length, 0);
});
await test("duplicate event delivery does not replay audio text or tools", () => {
  const seen = new Set<string>();
  const payload = { serverContent: { modelTurn: { parts: [{ text: "hello" }, { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }, { functionCall: { id: "tool", name: "readCurrentPage", args: {} } }] } } };
  const first = normalizeGeminiLiveServerEvent(payload, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3, seen: seen as never });
  const second = normalizeGeminiLiveServerEvent(payload, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3, seen: seen as never });
  assert.equal(first.audioChunks.length + first.textParts.length + first.toolCalls.length, 3);
  assert.equal(second.audioChunks.length + second.textParts.length + second.toolCalls.length, 0);
});
await test("input and output transcription remain distinct", () => {
  const value = normalizeGeminiLiveServerEvent({ serverContent: { inputTranscription: { text: "user said" }, outputTranscription: { text: "sema said" }, generationComplete: true } }, { connectionEpoch: 1, responseEpoch: 2, eventSequence: 3 });
  assert.equal(value.inputTranscript, "user said");
  assert.equal(value.inputTranscriptFinal, true);
  assert.equal(value.outputTranscript, "sema said");
  assert.equal(value.generationComplete, true);
});
await test("audio validation rejects empty and malformed chunks", () => {
  assert.equal(isValidLiveAudioBase64(""), false);
  assert.equal(isValidLiveAudioBase64("not base64"), false);
  assert.equal(isValidLiveAudioBase64("AAAA"), true);
});
await test("no first-part-only access remains in Live provider", () => {
  assert.doesNotMatch(readFileSync(resolve(root, "lib/live/providers/geminiLiveProvider.ts"), "utf8"), /parts\?\.\[0\]|parts\[[0]\]/);
});

await test("rate limiter accepts unique nonce", () => assert.equal(new LiveTokenRateLimiter(1).check("ip", "abcdefghijklmnop").allowed, true));
await test("rate limiter rejects reused nonce", () => { const limiter = new LiveTokenRateLimiter(3); limiter.check("ip", "abcdefghijklmnop"); assert.equal(limiter.check("ip", "abcdefghijklmnop").allowed, false); });
await test("rate limiter enforces request count", () => { const limiter = new LiveTokenRateLimiter(1); limiter.check("ip", "abcdefghijklmnop"); assert.equal(limiter.check("ip", "qrstuvwxyzabcdef").allowed, false); });
await test("safe token response contains no permanent key", () => {
  const status: LivePublicStatus = { uiEnabled: true, available: true, provider: "gemini_live", model: "live", voiceName: "Kore", thinkingLevel: "medium", maxSessionMinutes: 10, publicDemoTokenEnabled: false };
  const response = safeTokenResponse("ephemeral", new Date(0).toISOString(), status);
  assert.deepEqual(Object.keys(response).sort(), ["expiresAt", "model", "thinkingLevel", "token", "voiceName"]);
});
await test("ephemeral token is bounded to ten minutes", () => {
  const now = 1_000;
  const times = buildLiveTokenTimes(now, 10);
  assert.equal(times.expiresAt.getTime() - now, 600_000);
  assert.equal(times.newSessionExpiresAt.getTime() - now, 60_000);
});
await test("mock provider captures transport locally", async () => {
  const provider = new MockLiveProvider();
  await provider.connect({ token: "local", expiresAt: new Date().toISOString(), model: "mock", voiceName: "mock", thinkingLevel: "medium" }, () => {});
  provider.sendAudio("pcm"); provider.sendText("hello"); provider.sendContextDelta("delta");
  assert.deepEqual(provider.audio, ["pcm"]); assert.deepEqual(provider.text, ["hello"]); assert.deepEqual(provider.context, ["delta"]);
});
await test("denied permission returns failure without completion", async () => {
  const provider = new MockLiveProvider();
  await provider.connect({ token: "local", expiresAt: new Date().toISOString(), model: "mock", voiceName: "mock", thinkingLevel: "medium" }, () => {});
  const call = { id: "write-1", name: "prepareEvidencePacket", args: {} };
  provider.sendToolResult(call, { ok: false, message: "The user declined this action." });
  assert.equal(provider.results[0].result.ok, false);
  assert.equal(approved.packetDraft, undefined);
});
await test("tool completion follows a success result", async () => {
  const provider = new MockLiveProvider();
  await provider.connect({ token: "local", expiresAt: new Date().toISOString(), model: "mock", voiceName: "mock", thinkingLevel: "medium" }, () => {});
  const call = { id: "read-1", name: "readCurrentPage", args: {} };
  assert.equal(provider.results.length, 0);
  provider.sendToolResult(call, { ok: true, message: "The page was read." });
  assert.equal(provider.results[0].result.message, "The page was read.");
});
await test("photo tools cannot activate the camera or interpret images", () => {
  assert.deepEqual(LIVE_TOOL_NAMES.filter((name) => /photo/i.test(name)), ["openPhotoCapture", "readPhotoObservation"]);
  assert.match(LIVE_SYSTEM_INSTRUCTION, /Do not start microphone or camera access/);
  assert.match(LIVE_SYSTEM_INSTRUCTION, /Never.*interpret a photo/);
});
await test("Live instruction treats microphone audio as a spoken conversation", () => {
  assert.match(LIVE_SYSTEM_INSTRUCTION, /real-time spoken audio conversation/);
  assert.match(LIVE_SYSTEM_INSTRUCTION, /Never claim that you cannot hear/);
  assert.match(LIVE_SYSTEM_INSTRUCTION, /SEH-mah/);
});

const diagnosticDependencies = (overrides: Partial<DiagnosticDependencies> = {}): DiagnosticDependencies => ({
  model: "gemini-3.1-flash-live-preview",
  hasApiKey: true,
  checkModelVisibility: async () => ({ modelListed: true, modelNameMatched: true, inconclusive: false }),
  connectDirect: async () => ({ socketOpened: true, setupAccepted: true }),
  createMinimalToken: async () => ({ name: "auth_tokens/local-test", expiresAt: new Date(0).toISOString() }),
  connectConstrained: async () => ({ socketOpened: true, setupAccepted: true }),
  ...overrides
});

await test("diagnostic taxonomy does not collapse generic failures to model unavailable", () => {
  assert.equal(classifyDiagnosticFailure(new Error("socket refused"), "direct_live_connection").code, "direct_live_connect_failed");
});
await test("inconclusive model listing continues to direct Live", async () => {
  let directCalls = 0;
  const report = await runLiveDiagnosticLadder(diagnosticDependencies({
    checkModelVisibility: async () => ({ modelListed: false, modelNameMatched: false, inconclusive: true }),
    connectDirect: async () => { directCalls += 1; return { socketOpened: true, setupAccepted: true }; }
  }));
  assert.equal(report.passed, true);
  assert.equal(report.stages[0].listingStatus, "model_listing_inconclusive");
  assert.equal(directCalls, 1);
});
await test("direct connection failure stops before token creation", async () => {
  let tokenCalls = 0;
  const report = await runLiveDiagnosticLadder(diagnosticDependencies({
    connectDirect: async () => { throw new Error("socket refused"); },
    createMinimalToken: async () => { tokenCalls += 1; return { name: "unused", expiresAt: "unused" }; }
  }));
  assert.equal(report.stages.at(-1)?.code, "direct_live_connect_failed");
  assert.equal(tokenCalls, 0);
});
await test("direct setup rejection is distinct from connection failure", () => {
  const failure = new LiveDiagnosticFailure("setup invalid", { socketOpened: true });
  assert.equal(classifyDiagnosticFailure(failure, "direct_live_connection").code, "direct_live_setup_rejected");
});
await test("token failure stops before constrained socket", async () => {
  let constrainedCalls = 0;
  const report = await runLiveDiagnosticLadder(diagnosticDependencies({
    createMinimalToken: async () => { throw new Error("token service rejected request"); },
    connectConstrained: async () => { constrainedCalls += 1; return { socketOpened: true, setupAccepted: true }; }
  }));
  assert.equal(report.stages.at(-1)?.code, "token_create_failed");
  assert.equal(constrainedCalls, 0);
});
await test("constrained socket failure is distinct from token failure", async () => {
  const report = await runLiveDiagnosticLadder(diagnosticDependencies({ connectConstrained: async () => { throw new Error("socket refused"); } }));
  assert.equal(report.stages.at(-1)?.code, "constrained_socket_failed");
  assert.equal(report.stages.at(-1)?.tokenCreated, true);
});
await test("diagnostic redaction removes token names and permanent keys", () => {
  const key = "AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
  const token = "auth_tokens/secret-token-value";
  const safe = sanitizeDiagnosticText(`api_key=${key} token=${token}`, [key, token]);
  assert.equal(safe.includes(key), false);
  assert.equal(safe.includes(token), false);
});
await test("diagnostic redaction removes authenticated websocket URLs", () => {
  const safe = sanitizeDiagnosticText(`${CONSTRAINED_LIVE_ENDPOINT}?access_token=auth_tokens/secret`);
  assert.equal(safe.includes("access_token="), false);
  assert.equal(safe.includes("generativelanguage.googleapis.com"), false);
});
await test("minimal token creation uses v1alpha", () => assert.equal(TOKEN_API_VERSION, "v1alpha"));
await test("Phase 1A token mint leaves Live setup unlocked for browser setup", () => {
  const source = readFileSync(resolve(root, "lib/live/ephemeralToken.ts"), "utf8");
  assert.doesNotMatch(source, /liveConnectConstraints|lockAdditionalFields|buildGeminiLiveSessionConfig/);
  assert.match(source, /uses: 1/);
  assert.match(source, /apiVersion: "v1alpha"/);
});
await test("ephemeral transport uses constrained v1alpha endpoint", () => assert.match(CONSTRAINED_LIVE_ENDPOINT, /v1alpha\.GenerativeService\.BidiGenerateContentConstrained$/));
await test("ephemeral transport uses access_token query parameter", () => assert.equal(CONSTRAINED_TOKEN_QUERY_PARAMETER, "access_token"));
await test("permanent-key diagnostic uses normal server API version", () => assert.equal(DIRECT_LIVE_API_VERSION, "v1beta"));
await test("empty token setup allows connection setup", () => assert.equal(resolveTokenSetupSemantics({ hasEmbeddedSetup: false }), "connection_supplies_setup"));
await test("embedded token setup replaces connection setup", () => assert.equal(resolveTokenSetupSemantics({ hasEmbeddedSetup: true }), "token_replaces_setup"));
await test("field mask represents selective token overrides", () => assert.equal(resolveTokenSetupSemantics({ hasEmbeddedSetup: true, fieldMask: ["config.responseModalities"] }), "field_mask_overrides_connection"));
await test("constraint probes lock only incrementally supplied fields", () => assert.deepEqual(CONSTRAINT_PROBE_LOCK_ADDITIONAL_FIELDS, []));
await test("tool declarations are supplied at Live setup rather than embedded in the token", () => {
  assert.equal(buildTokenConstraintConfig("one_read_only_tool", "Kore")?.tools, undefined);
  assert.equal(buildTokenConstraintConfig("full_approved_tools", "Kore")?.tools, undefined);
});
await test("voice rejection has a dedicated code", () => assert.equal(classifyDiagnosticFailure(new Error("invalid setup"), "constraint_probe", "voice_kore").code, "voice_config_rejected"));
await test("thinking rejection has a dedicated code", () => assert.equal(classifyDiagnosticFailure(new Error("invalid setup"), "constraint_probe", "thinking_low").code, "thinking_config_rejected"));
await test("tool rejection has a dedicated code", () => assert.equal(classifyDiagnosticFailure(new Error("invalid schema"), "constraint_probe", "one_read_only_tool").code, "tool_config_rejected"));
await test("transcription rejection has a dedicated code", () => assert.equal(classifyDiagnosticFailure(new Error("invalid setup"), "constraint_probe", "input_transcription").code, "transcription_config_rejected"));
await test("rate limiting stops later constraint probes", async () => {
  let calls = 0;
  const report = await runConstraintProbes("live", async () => {
    calls += 1;
    throw new Error("429 resource_exhausted");
  });
  assert.equal(report.results[0].code, "rate_limited");
  assert.equal(calls, 1);
});
await test("timeout stops later constraint probes", async () => {
  let calls = 0;
  const report = await runConstraintProbes("live", async () => {
    calls += 1;
    throw new Error("deadline timed out");
  });
  assert.equal(report.results[0].code, "timeout");
  assert.equal(calls, 1);
});
await test("constraint probe list is ordered and has no hidden retries", async () => {
  const calls: string[] = [];
  const report = await runConstraintProbes("live", async (feature) => {
    calls.push(feature);
    return { passed: true, tokenCreated: true, socketOpened: true, setupAccepted: true };
  });
  assert.equal(report.passed, true);
  assert.deepEqual(calls, [...LIVE_CONSTRAINT_FEATURES]);
  assert.equal(report.results.every((result) => typeof result.latencyMs === "number"), true);
});
await test("provider operations have a bounded timeout", async () => {
  await assert.rejects(withDiagnosticTimeout(new Promise(() => {}), 1, "test operation"), /timed out/);
});

const smokeTimeouts = {
  operationMs: 5, preparingSyntheticAudioMs: 5, validatingSyntheticAudioMs: 5,
  tokenCreationMs: 5, socketOpenMs: 5, setupCompleteMs: 5,
  dispatchingSyntheticAudioMs: 5, signalingAudioEndMs: 5, textProbeDispatchMs: 5,
  modelAudioMs: 5, validationMs: 5, readToolMs: 5, writePermissionMs: 5,
  interruptionMs: 5, safetyResponseMs: 5, closeMs: 5, globalMs: 100
};
const runFakeSmoke = (driver: FakeRealLiveSmokeDriver, onStage?: (event: RealLiveSmokeStageEvent) => void, timeouts = smokeTimeouts) => runRealLiveSmoke(driver, { timeouts, onStage });

await test("synthetic PCM fixture is generated without platform I/O", () => assert.ok(createDeterministicPcmFixture().length > 0));
await test("synthetic PCM metadata is 16 kHz mono PCM16", () => {
  const metadata = validateSyntheticPcm(createDeterministicPcmFixture());
  assert.equal(metadata.sampleRate, 16_000); assert.equal(metadata.channels, 1); assert.equal(metadata.bitDepth, 16);
});
await test("synthetic PCM has no RIFF header", () => assert.notEqual(createDeterministicPcmFixture().subarray(0, 4).toString("ascii"), "RIFF"));
await test("synthetic PCM has an even byte length", () => assert.equal(createDeterministicPcmFixture().length % 2, 0));
await test("synthetic PCM duration is deterministic", () => assert.equal(validateSyntheticPcm(createDeterministicPcmFixture()).durationMs, 750));
await test("synthetic PCM contains no clipped samples", () => assert.equal(validateSyntheticPcm(createDeterministicPcmFixture()).clippedSamples, 0));
await test("empty synthetic PCM is rejected", () => assert.throws(() => validateSyntheticPcm(Buffer.alloc(0)), /empty/));
await test("invalid synthetic PCM sample rate is rejected", () => assert.throws(() => validateSyntheticPcm(createDeterministicPcmFixture(), { sampleRate: 8_000 }), /sample rate/));
await test("valid model audio is accepted", () => assert.equal(validateModelAudio([Buffer.alloc(320).toString("base64")]).byteLength, 320));
await test("empty model audio is rejected", () => assert.throws(() => validateModelAudio([]), /empty/));
await test("odd-length model audio is rejected", () => assert.throws(() => validateModelAudio([Buffer.alloc(3).toString("base64")]), /invalid/));
await test("automatic VAD uses only audioStreamEnd", () => {
  assert.equal(audioBoundaryMessages("automatic").before, undefined);
  assert.deepEqual(audioBoundaryMessages("automatic").after, { audioStreamEnd: true });
});
await test("manual VAD uses activity boundaries", () => {
  assert.deepEqual(audioBoundaryMessages("manual").before, { activityStart: {} });
  assert.deepEqual(audioBoundaryMessages("manual").after, { activityEnd: {} });
});
await test("automatic and manual VAD boundaries cannot be mixed", () => {
  const automatic = audioBoundaryMessages("automatic");
  const manual = audioBoundaryMessages("manual");
  assert.equal("activityStart" in (automatic.before ?? {}), false);
  assert.equal("audioStreamEnd" in manual.after, false);
});

await test("real smoke prepares and validates PCM before token creation", async () => {
  const driver = new FakeRealLiveSmokeDriver();
  const result = await runFakeSmoke(driver);
  assert.equal(result.passed, true);
  assert.ok(driver.calls.indexOf("validating_synthetic_audio") < driver.calls.indexOf("creating_ephemeral_token"));
  assert.ok(driver.calls.indexOf("creating_ephemeral_token") < driver.calls.indexOf("opening_constrained_socket"));
});
await test("synthetic PCM preparation timeout prevents token creation", async () => {
  const events: RealLiveSmokeStageEvent[] = [];
  const driver = new FakeRealLiveSmokeDriver({ hangStage: "preparing_synthetic_audio" });
  const result = await runFakeSmoke(driver, (event) => events.push(event));
  assert.equal(result.failedStage, "preparing_synthetic_audio");
  assert.equal(result.errorCode, "synthetic_audio_prepare_timeout");
  assert.equal(driver.calls.includes("creating_ephemeral_token"), false);
  assert.equal(events.some((event) => event.stage === "creating_ephemeral_token" && event.status === "not_run"), true);
});
for (const [name, stage] of [
  ["token creation", "creating_ephemeral_token"],
  ["socket open", "opening_constrained_socket"],
  ["setup", "waiting_for_setup_complete"],
  ["audio dispatch", "dispatching_synthetic_audio"],
  ["audio end signal", "signaling_audio_end"],
  ["text probe dispatch", "sending_text_audio_response_probe"],
  ["model audio", "waiting_for_model_audio"],
  ["read tool", "testing_read_tool"],
  ["write tool", "testing_write_permission"],
  ["interruption", "testing_interruption"],
  ["safety response", "testing_safety_refusal"]
] as Array<[string, RealLiveSmokeStage]>) {
  await test(`real smoke ${name} timeout identifies its stage`, async () => {
    const result = await runFakeSmoke(new FakeRealLiveSmokeDriver({ hangStage: stage }));
    assert.equal(result.failedStage, stage);
    const expected = stage === "dispatching_synthetic_audio" ? "audio_dispatch_timeout" : stage === "waiting_for_model_audio" ? "model_audio_timeout" : "stage_timeout";
    assert.equal(result.errorCode, expected);
    assert.equal(result.cleanupCompleted, true);
  });
}
await test("audio dispatch completes before provider audio is awaited", async () => {
  const driver = new FakeRealLiveSmokeDriver({ hangStage: "waiting_for_model_audio" });
  const result = await runFakeSmoke(driver);
  assert.equal(result.syntheticAudioDispatched, true);
  assert.equal(result.failedStage, "waiting_for_model_audio");
});
await test("audio dispatch failure is distinct from model response timeout", async () => {
  const dispatch = await runFakeSmoke(new FakeRealLiveSmokeDriver({ failStage: "dispatching_synthetic_audio" }));
  const response = await runFakeSmoke(new FakeRealLiveSmokeDriver({ hangStage: "waiting_for_model_audio" }));
  assert.equal(dispatch.errorCode, "audio_dispatch_failed");
  assert.equal(response.errorCode, "model_audio_timeout");
});
await test("text audio probe is independent from synthetic input dispatch", async () => {
  const driver = new FakeRealLiveSmokeDriver();
  await runFakeSmoke(driver);
  assert.ok(driver.calls.indexOf("dispatching_synthetic_audio") < driver.calls.indexOf("sending_text_audio_response_probe"));
  assert.ok(driver.calls.indexOf("sending_text_audio_response_probe") < driver.calls.indexOf("waiting_for_model_audio"));
});
await test("missing optional transcription is reported without failing smoke", async () => {
  const result = await runFakeSmoke(new FakeRealLiveSmokeDriver({ transcriptionReceived: false }));
  assert.equal(result.passed, true); assert.equal(result.transcriptionReceived, false);
});
await test("invalid model audio stops before transcription validation", async () => {
  const events: RealLiveSmokeStageEvent[] = [];
  const result = await runFakeSmoke(new FakeRealLiveSmokeDriver({ failStage: "validating_model_audio" }), (event) => events.push(event));
  assert.equal(result.errorCode, "model_audio_invalid");
  assert.equal(events.some((event) => event.stage === "validating_transcription" && event.status === "not_run"), true);
});
await test("real smoke global timeout identifies the latest stage", async () => {
  const result = await runFakeSmoke(new FakeRealLiveSmokeDriver({ hangStage: "waiting_for_model_audio" }), undefined, { ...smokeTimeouts, modelAudioMs: 100, globalMs: 2 });
  assert.equal(result.failedStage, "waiting_for_model_audio");
  assert.equal(result.errorCode, "global_timeout");
});
await test("every real smoke operation failure invokes cleanup", async () => {
  const driver = new FakeRealLiveSmokeDriver({ failStage: "testing_write_permission" });
  const result = await runFakeSmoke(driver);
  assert.equal(result.cleanupCompleted, true);
  assert.equal(driver.cleanupCalls, 1);
});
await test("real smoke cleanup is idempotent", async () => {
  const driver = new FakeRealLiveSmokeDriver();
  await driver.cleanup();
  const second = await driver.cleanup();
  assert.equal(second.cleanupCompleted, true);
  assert.equal(driver.cleanupCalls, 1);
});
await test("late socket events are ignored after cleanup", async () => {
  const driver = new FakeRealLiveSmokeDriver(); await runFakeSmoke(driver); driver.emitLateSocketEvent(); assert.equal(driver.lateSocketMutations, 0);
});
await test("late audio chunks are ignored after cleanup", async () => {
  const driver = new FakeRealLiveSmokeDriver(); await runFakeSmoke(driver); driver.emitLateAudio(); assert.equal(driver.lateAudioMutations, 0);
});
await test("late transcripts are ignored after cleanup", async () => {
  const driver = new FakeRealLiveSmokeDriver(); await runFakeSmoke(driver); driver.emitLateTranscript(); assert.equal(driver.lateTranscriptMutations, 0);
});
await test("all real smoke stage timers are cleared", async () => assert.equal((await runFakeSmoke(new FakeRealLiveSmokeDriver())).timersCleared, true));
await test("real smoke listeners are removed", async () => assert.equal((await runFakeSmoke(new FakeRealLiveSmokeDriver())).listenersRemoved, true));
await test("real smoke socket close is bounded", async () => {
  const result = await runFakeSmoke(new FakeRealLiveSmokeDriver({ hangStage: "closing_session" }));
  assert.equal(result.failedStage, "closing_session");
  assert.equal(result.cleanupCompleted, true);
});
await test("real smoke final JSON reporter emits exactly once", async () => {
  const lines: string[] = [];
  const report = createFinalResultReporter((line) => lines.push(line));
  const result = await runFakeSmoke(new FakeRealLiveSmokeDriver());
  assert.equal(report(result), true); assert.equal(report(result), false); assert.equal(lines.length, 1);
});
await test("real smoke success is reported only after cleanup", async () => {
  const events: RealLiveSmokeStageEvent[] = [];
  const result = await runFakeSmoke(new FakeRealLiveSmokeDriver(), (event) => events.push(event));
  const cleanupPassed = events.findIndex((event) => event.stage === "cleanup" && event.status === "passed");
  assert.equal(result.passed, true); assert.equal(cleanupPassed, events.length - 1);
});
await test("real smoke failure exits nonzero", async () => assert.equal(exitCodeForSmokeResult(await runFakeSmoke(new FakeRealLiveSmokeDriver({ failStage: "dispatching_setup" }))), 1));
await test("real smoke success exits zero", async () => assert.equal(exitCodeForSmokeResult(await runFakeSmoke(new FakeRealLiveSmokeDriver())), 0));
await test("real smoke fallback cannot count as success", async () => assert.equal((await runFakeSmoke(new FakeRealLiveSmokeDriver({ fallbackUsed: true }))).passed, false));
await test("real smoke stage logs contain no key or token", async () => {
  const events: RealLiveSmokeStageEvent[] = [];
  await runFakeSmoke(new FakeRealLiveSmokeDriver(), (event) => events.push(event));
  const output = JSON.stringify(events);
  assert.equal(/AIza|auth_tokens\//.test(output), false);
});
await test("real smoke failures never log authenticated URLs", async () => {
  const events: RealLiveSmokeStageEvent[] = [];
  await runFakeSmoke(new FakeRealLiveSmokeDriver({ failStage: "opening_constrained_socket" }), (event) => events.push(event));
  assert.equal(JSON.stringify(events).includes("access_token="), false);
});

const writeProbeTimeouts = {
  operationMs: 5, tokenMs: 5, socketMs: 5, setupMs: 5, promptMs: 5,
  toolCallMs: 5, validationMs: 5, permissionMs: 5, responseMs: 5,
  acknowledgementMs: 5, closeMs: 5, cleanupMs: 5, globalMs: 100
};
const runFakeWriteProbe = (driver: FakeWriteToolProbeDriver, timeouts = writeProbeTimeouts) => runWriteToolProbe(driver, { timeouts });
const writeCall = { id: "write-1", name: "prepareEvidencePacket", args: {} };

await test("dedicated write probe declares only prepareEvidencePacket", () => {
  assert.equal(WRITE_TOOL_PROBE_DECLARATIONS.length, 1);
  assert.equal(WRITE_TOOL_PROBE_DECLARATIONS[0].name, "prepareEvidencePacket");
});
await test("production Live tool allowlist contains only approved tools", () => assert.equal(LIVE_FUNCTION_DECLARATIONS.length, LIVE_TOOL_NAMES.length));
await test("test-only write instruction does not replace production instruction", () => {
  assert.notEqual(WRITE_TOOL_PROBE_SYSTEM_INSTRUCTION, LIVE_SYSTEM_INSTRUCTION);
  assert.match(LIVE_SYSTEM_INSTRUCTION, /page-aware evidence organization assistant/);
});
await test("write request uses real-time text input shape", () => {
  assert.deepEqual(createWriteRequestRealtimeInput(), { text: WRITE_TOOL_PROBE_PROMPT });
  assert.equal("turnComplete" in createWriteRequestRealtimeInput(), false);
});
await test("write request follows setup completion", async () => {
  const driver = new FakeWriteToolProbeDriver(); await runFakeWriteProbe(driver);
  assert.ok(driver.calls.indexOf("waiting_for_setup_complete") < driver.calls.indexOf("sending_write_request"));
});
await test("write request starts before any model turn stage", async () => {
  const driver = new FakeWriteToolProbeDriver(); await runFakeWriteProbe(driver);
  assert.ok(driver.calls.indexOf("sending_write_request") < driver.calls.indexOf("waiting_for_write_tool_call"));
});
await test("sanitized write trace excludes user text", () => {
  const unsafe = { event: "write_prompt_sent" as const, elapsedMs: 1, userText: WRITE_TOOL_PROBE_PROMPT };
  assert.equal(JSON.stringify(sanitizeWriteProbeEvent(unsafe)).includes(WRITE_TOOL_PROBE_PROMPT), false);
});
await test("sanitized write trace excludes tokens and URLs", () => {
  const unsafe = { event: "socket_open" as const, elapsedMs: 1, token: "auth_tokens/secret", url: "wss://example.test?access_token=secret" };
  const output = JSON.stringify(sanitizeWriteProbeEvent(unsafe));
  assert.equal(/auth_tokens|access_token|wss:/.test(output), false);
});
await test("expected dedicated write tool passes", () => assert.equal(validateDedicatedWriteCall(writeCall).ok, true));
await test("unexpected dedicated write tool fails", () => assert.equal(validateDedicatedWriteCall({ ...writeCall, name: "readCurrentPage" }).ok, false));
await test("missing function-call ID fails", () => assert.deepEqual(validateDedicatedWriteCall({ ...writeCall, id: "" }), { ok: false, code: "write_tool_missing_id" }));
await test("unknown write-tool argument fails", () => assert.deepEqual(validateDedicatedWriteCall({ ...writeCall, args: { arbitrary: true } }), { ok: false, code: "write_tool_payload_invalid" }));
await test("model cannot supply trusted risk", () => assert.equal(validateDedicatedWriteCall({ ...writeCall, args: { riskLevel: "read_only" } }).ok, false));
await test("model cannot supply permission outcome", () => assert.equal(validateDedicatedWriteCall({ ...writeCall, args: { permissionRequired: false } }).ok, false));
await test("canonical registry determines write risk", () => assert.equal(validateCanonicalWriteAction(writeCall, packetReadyApproved).riskLevel, "write"));
await test("canonical permission gate requires visible confirmation", () => {
  const action = validateCanonicalWriteAction(writeCall, packetReadyApproved);
  assert.equal(evaluateCanonicalWritePermission(writeCall, action).permissionRequired, true);
});
await test("canonical permission evaluation does not mutate session", () => {
  const before = JSON.stringify(packetReadyApproved);
  evaluateCanonicalWritePermission(writeCall, validateCanonicalWriteAction(writeCall, packetReadyApproved));
  assert.equal(JSON.stringify(packetReadyApproved), before);
});
await test("canonical permission evaluation creates no packet", () => {
  evaluateCanonicalWritePermission(writeCall, validateCanonicalWriteAction(writeCall, packetReadyApproved));
  assert.equal(packetReadyApproved.packetDraft, undefined);
});
await test("permission response uses matching function-call ID", () => {
  assert.equal(createConfirmationRequiredResponse(writeCall).functionResponses[0].id, writeCall.id);
});
await test("permission response reports confirmation_required", () => {
  assert.equal(createConfirmationRequiredResponse(writeCall).functionResponses[0].response.status, "confirmation_required");
});
await test("permission response never reports false success", () => {
  assert.equal(createConfirmationRequiredResponse(writeCall).functionResponses[0].response.ok, false);
});
await test("early packet-completion wording is rejected", () => assert.equal(hasEarlyCompletionClaim("Your evidence packet is ready."), true));
await test("confirmation-required acknowledgement passes", () => {
  assert.equal(isConfirmationRequiredAcknowledgement("The packet is not prepared. You must confirm on screen first."), true);
});
await test("spoken response without a tool is classified separately", () => assert.equal(classifyToollessTurn(true), "model_spoke_instead_of_tool"));
await test("turn completion without a tool is classified separately", () => assert.equal(classifyToollessTurn(false), "turn_completed_without_tool"));
await test("write-tool timeout invokes cleanup", async () => {
  const driver = new FakeWriteToolProbeDriver({ hangStage: "waiting_for_write_tool_call" });
  const result = await runFakeWriteProbe(driver);
  assert.equal(result.errorCode, "write_tool_timeout"); assert.equal(result.cleanupCompleted, true);
});
await test("write-probe provider error invokes cleanup", async () => {
  const driver = new FakeWriteToolProbeDriver({ failStage: "opening_socket" });
  const result = await runFakeWriteProbe(driver);
  assert.equal(result.errorCode, "provider_error"); assert.equal(result.cleanupCompleted, true);
});
await test("write-probe socket closes cleanly", async () => assert.equal((await runFakeWriteProbe(new FakeWriteToolProbeDriver())).socketClosed, true));
await test("write probe has no automatic retry", async () => {
  const driver = new FakeWriteToolProbeDriver({ failStage: "opening_socket" }); await runFakeWriteProbe(driver);
  assert.equal(driver.calls.filter((stage) => stage === "creating_ephemeral_token").length, 1);
});
await test("write probe passes only after permission acknowledgement", async () => {
  const result = await runFakeWriteProbe(new FakeWriteToolProbeDriver());
  assert.equal(result.passed, true); assert.equal(result.permissionAcknowledgementReceived, true); assert.equal(result.actionExecuted, false);
});
await test("write probe final reporter emits exactly once", async () => {
  const lines: string[] = []; const report = createWriteToolProbeReporter((line) => lines.push(line));
  const result = await runFakeWriteProbe(new FakeWriteToolProbeDriver());
  assert.equal(report(result), true); assert.equal(report(result), false); assert.equal(lines.length, 1);
});
await test("write probe failure exits nonzero", async () => {
  const result = await runFakeWriteProbe(new FakeWriteToolProbeDriver({ hangStage: "waiting_for_write_tool_call" }));
  assert.equal(writeToolProbeExitCode(result), 1);
});
await test("Live output watchdog uses bounded recovery timing", () => {
  assert.deepEqual(LIVE_OUTPUT_WATCHDOG, { transcriptToFirstAudioMs: 1_800, audioChunkToPlaybackMs: 900, playbackProgressStallMs: 1_800, recoveryAttemptLimit: 1 });
});
await test("Live output diagnostics start sanitized", () => {
  const diagnostics = createLiveOutputDiagnostics(1_000);
  assert.equal(diagnostics.audioChunkCount, 0);
  assert.equal(diagnostics.outputTranscriptObserved, false);
  assert.equal(diagnostics.audioPartCount, 0);
  assert.equal(diagnostics.decodedAudioChunkCount, 0);
  assert.equal(diagnostics.decodedSampleCount, 0);
  assert.equal(diagnostics.playbackScheduled, false);
  assert.equal(diagnostics.playbackStarted, false);
  assert.equal(diagnostics.playbackCompleted, false);
  assert.equal("transcriptText" in diagnostics, false);
  assert.equal("assistantText" in diagnostics, false);
  assert.equal("userText" in diagnostics, false);
});
await test("Live output byte estimate avoids storing PCM", () => assert.equal(estimateBase64Bytes("AAAA"), 3));
await test("Live hook exposes intro diagnostics in page memory only", () => assert.match(readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8"), /__semaLiveIntroDiagnostics/));
await test("Live hook does not buffer intro audio for regeneration or replay", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.doesNotMatch(hook, /responseAudioBufferRef|queueAudioChunks|replayBufferedOutputOnce/);
  assert.match(hook, /LivePcmOutputPlayer/);
});
await test("Live output failure categories are explicit and sanitized", () => {
  const output = readFileSync(resolve(root, "lib/live/liveOutputState.ts"), "utf8");
  for (const category of ["provider_no_audio", "audio_decode_failed", "audio_context_suspended", "audio_context_closed", "playback_not_scheduled", "playback_never_started", "playback_stalled", "stale_epoch_rejected", "connection_closed_early", "unknown"]) assert.match(output, new RegExp(`"${category}"`));
  for (const forbidden of ["apiKey", "ephemeralToken", "pcmBytes", "base64Audio", "patientInformation", "deviceId"]) assert.equal(output.includes(forbidden), false);
});
await test("Live hook classifies text without audio as the Phase 1A boundary", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /transcript_without_audio_parts/);
  assert.match(hook, /FIRST_AUDIO_TIMEOUT_MS = 20_000/);
});
await test("Live hook classifies invalid intro audio through explicit boundaries", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /audio_parts_without_data/);
  assert.match(hook, /unsupported_audio_mime/);
  assert.match(hook, /pcm_decode_failed/);
});
await test("Phase 1A player requests 24 kHz and resumes suspended AudioContext", () => {
  const player = readFileSync(resolve(root, "lib/live/livePcmOutputPlayer.ts"), "utf8");
  assert.match(player, /new this\.audioContextFactory\(\{ sampleRate: LIVE_OUTPUT_SAMPLE_RATE \}\)/);
  assert.match(player, /context\.state === "suspended"[\s\S]*await this\.context\.resume\(\)/);
});
await test("Phase 1A player schedules decoded audio sequentially", () => {
  const player = readFileSync(resolve(root, "lib/live/livePcmOutputPlayer.ts"), "utf8");
  assert.match(player, /decodeBase64Pcm16LittleEndian/);
  assert.match(player, /Math\.max\(this\.nextStartTime, context\.currentTime \+ 0\.01\)/);
  assert.match(player, /const endAt = startAt \+ buffer\.duration/);
  assert.match(player, /this\.nextStartTime = endAt/);
});
await test("Phase 1A does not use stale-epoch or chunk de-duplication", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  const parser = readFileSync(resolve(root, "lib/live/liveIntroParser.ts"), "utf8");
  assert.doesNotMatch(hook + parser, /responseEpoch|dedup|duplicateAudio|seenAudio/);
});
await test("Phase 1C hook waits for drain turnComplete and cooldown before listening", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(hook, /waitForDrain\(\{ graceMs: LIVE_PLAYER_DRAIN_GRACE_MS \}\)/);
  assert.match(hook, /markServerTurnCompleteForCurrentOutput/);
  assert.match(hook, /phase1CCooldownMs\(\)/);
  assert.match(hook, /dispatch\(\{ type: "listen" \}\)/);
  assert.equal(canForwardPcm("assistant_speaking"), false);
  assert.equal(canForwardPcm("post_playback_cooldown"), false);
});
await test("intro phases clear stale reconnect output copy", () => {
  const reconnecting = liveStateReducer(initialLiveState, { type: "reconnect" });
  assert.equal(reconnecting.outputState, "recovering_session");
  const setupWaiting = liveStateReducer(reconnecting, { type: "intro_phase", phase: "setup_waiting" });
  assert.equal(setupWaiting.outputState, "idle");
  assert.equal(setupWaiting.voiceNotice, undefined);
});
await test("Live hook has no automatic intro retry or provider switch", () => {
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.doesNotMatch(hook, /replayBufferedOutputOnce|provider switch|model switch|LIVE_REENTRY_MESSAGE/);
  assert.match(hook, /duplicate_intro_attempt/);
});
await test("Live degraded text copy is explicit", () => assert.equal(LIVE_OUTPUT_DEGRADED_MESSAGE, "Sema’s response is available as text, but no playable Live audio was received."));
await test("Live reconnecting copy is explicit", () => assert.match(LIVE_OUTPUT_RECONNECTING_MESSAGE, /Reconnecting voice/));
await test("Live UI exposes Retry voice only when buffered PCM remains", () => {
  const controls = readFileSync(resolve(root, "components/live/LiveAgentControls.tsx"), "utf8");
  assert.match(controls, /live\.canRetryVoiceOutput \?/);
  assert.match(controls, /Retry voice/);
});
await test("Live no-buffer recovery exposes Reconnect voice and does not regenerate", () => {
  const controls = readFileSync(resolve(root, "components/live/LiveAgentControls.tsx"), "utf8");
  const hook = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8");
  assert.match(controls, /Reconnect voice/);
  assert.match(hook, /function reconnectVoice\(\)/);
  assert.doesNotMatch(hook.match(/function retryVoiceOutput\(\)[\s\S]*?function continueWithText/)?.[0] ?? "", /retry\(\)|sendText|sendAudio|sendToolResult/);
});
await test("Live reconnect does not repeat tools introduction or prior speech", () => {
  const reconnect = readFileSync(resolve(root, "hooks/useSemaLiveSession.ts"), "utf8").match(/function reconnectVoice\(\)[\s\S]*?}\n/)?.[0] ?? "";
  assert.match(reconnect, /retry\(\)/);
  assert.doesNotMatch(reconnect, /sendText|sendAudio|sendToolResult|LIVE_INTRODUCTION_PROMPT/);
});
await test("Live UI exposes Continue with text", () => assert.match(readFileSync(resolve(root, "components/live/LiveAgentControls.tsx"), "utf8"), /Continue with text/));
await test("Gemini Live connection preserves AUDIO modality", () => assert.match(readFileSync(resolve(root, "lib/live/liveSessionConfig.ts"), "utf8"), /responseModalities: \[Modality\.AUDIO\]/));
await test("Gemini Live connection preserves Kore-capable speech config", () => assert.match(readFileSync(resolve(root, "lib/live/providers/geminiLiveProvider.ts"), "utf8"), /voiceName: token\.voiceName \|\| "Kore"/));
await test("Gemini Live provider uses one canonical config builder", () => assert.match(readFileSync(resolve(root, "lib/live/providers/geminiLiveProvider.ts"), "utf8"), /buildGeminiLiveSessionConfig/));

  process.stdout.write(`\n${passed} local Gemini Live architecture checks passed. No provider call was made.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
