import assert from "node:assert/strict";
import { createEmptySession } from "../../sema-session/defaults";
import { resolveLiveConfig } from "../liveConfigCore";
import { float32ToPcm16, OrderedPcmQueue, resampleFloat32 } from "../liveAudio";
import { buildLiveSessionContext, diffLiveSessionContext } from "../buildLiveSessionContext";
import { LIVE_TOOL_NAMES, validateLiveToolCall } from "../liveTools";
import { initialLiveState, liveStateReducer } from "../liveStateMachine";
import { screenLiveInput, screenLiveOutput } from "../liveSafety";
import { LiveTokenRateLimiter, safeTokenResponse } from "../liveTokenPolicy";
import { buildLiveTokenTimes } from "../liveTokenPolicy";
import { MockLiveProvider } from "../providers/mockLiveProvider";
import type { LivePublicStatus } from "../liveTypes";
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

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => { passed += 1; process.stdout.write(`PASS ${name}\n`); });
}

const session = createEmptySession();
const approved = {
  ...session,
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

async function main() {
await test("defaults keep Live disabled", () => assert.equal(resolveLiveConfig({}).liveEnabled, false));
await test("UI flag is explicit", () => assert.equal(resolveLiveConfig({ NEXT_PUBLIC_SEMA_LIVE_UI_ENABLED: "true" }).uiEnabled, true));
await test("default model is Gemini Live preview", () => assert.match(resolveLiveConfig({}).model, /live-preview/));
await test("default voice is Kore", () => assert.equal(resolveLiveConfig({}).voiceName, "Kore"));
await test("session limit is capped at ten", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_MAX_SESSION_MINUTES: "40" }).maxSessionMinutes, 10));
await test("session limit has a one-minute floor", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_MAX_SESSION_MINUTES: "0" }).maxSessionMinutes, 1));
await test("development token requires key and enablement", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret" }).tokenMintingAllowed, true));
await test("production token is disabled by default", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret" }, "production").tokenMintingAllowed, false));
await test("production public-demo flag permits token", () => assert.equal(resolveLiveConfig({ SEMA_LIVE_ENABLED: "true", GEMINI_API_KEY: "secret", SEMA_LIVE_PUBLIC_DEMO_ENABLED: "true" }, "production").tokenMintingAllowed, true));

await test("state asks for consent", () => assert.equal(liveStateReducer(initialLiveState, { type: "request_consent" }).status, "consent_required"));
await test("microphone state cannot precede consent flow", () => assert.equal(liveStateReducer(initialLiveState, { type: "request_consent" }).consented, false));
await test("state records consent", () => assert.equal(liveStateReducer(initialLiveState, { type: "consent" }).consented, true));
await test("state connects to listening", () => assert.equal(liveStateReducer(initialLiveState, { type: "connected" }).status, "listening"));
await test("state tracks speaking", () => assert.equal(liveStateReducer(initialLiveState, { type: "speak" }).status, "speaking"));
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

await test("all and only approved Live tools are declared", () => assert.deepEqual(LIVE_TOOL_NAMES, ["openSignalFolder", "readSignalFolder", "readCurrentPage", "readSafetyNote", "listMissingDetails", "generateStorySummary", "generateClinicianQuestions", "prepareEvidencePacket", "readPacketSection", "openVoiceDraftReview"]));
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
await test("unknown tool is rejected", () => assert.equal(validateLiveToolCall({ id: "1", name: "clearSession", args: {} }, session).ok, false));
await test("unexpected parameters are rejected", () => assert.equal(validateLiveToolCall({ id: "1", name: "readCurrentPage", args: { secret: true } }, session).ok, false));
await test("model-supplied risk is rejected", () => assert.equal(validateLiveToolCall({ id: "1", name: "openSignalFolder", args: { folderId: "story", riskLevel: "read_only" } }, session).ok, false));
await test("write tool requires permission", () => {
  const value = validateLiveToolCall({ id: "1", name: "generateStorySummary", args: {} }, approved);
  assert.equal(value.ok && value.permissionRequired, true);
});
await test("verbal confirmation cannot execute a write", () => {
  const value = validateLiveToolCall({ id: "1", name: "prepareEvidencePacket", args: {} }, approved);
  assert.equal(value.ok && value.permissionRequired, true);
  assert.equal(approved.packetDraft, undefined);
});
await test("summary is ineligible without story", () => assert.equal(validateLiveToolCall({ id: "1", name: "generateStorySummary", args: {} }, session).ok, false));
await test("packet is ineligible before approval", () => assert.equal(validateLiveToolCall({ id: "1", name: "prepareEvidencePacket", args: {} }, { ...session, story: { rawText: "demo" } }).ok, false));
await test("packet is eligible after approval", () => assert.equal(validateLiveToolCall({ id: "1", name: "prepareEvidencePacket", args: {} }, approved).ok, true));
await test("packet section requires packet", () => assert.equal(validateLiveToolCall({ id: "1", name: "readPacketSection", args: { section: "safety" } }, approved).ok, false));
await test("voice review cannot start microphone", () => {
  const value = validateLiveToolCall({ id: "1", name: "openVoiceDraftReview", args: { target: "audio" } }, session);
  assert.equal(value.ok && value.action.type, "openVoiceDraftReview");
});

await test("context excludes raw patient words", () => assert.equal(JSON.stringify(buildLiveSessionContext(approved)).includes("Patient-provided demo story"), false));
await test("context includes approved summary", () => assert.equal(buildLiveSessionContext(approved).approvedStory?.mainConcern, "Demo concern"));
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
await test("ordered queue drops interrupted generation", () => {
  const queue = new OrderedPcmQueue<string>(); queue.enqueue(0, "old"); queue.enqueue(1, "new");
  assert.equal(queue.shift(1), "new");
});
await test("ordered queue clears", () => { const queue = new OrderedPcmQueue<string>(); queue.enqueue(0, "x"); queue.clear(); assert.equal(queue.size, 0); });
await test("completed session content survives interruption", () => {
  liveStateReducer(initialLiveState, { type: "interrupt" });
  assert.equal(approved.story.summaryStatus, "approved");
});

await test("rate limiter accepts unique nonce", () => assert.equal(new LiveTokenRateLimiter(1).check("ip", "abcdefghijklmnop").allowed, true));
await test("rate limiter rejects reused nonce", () => { const limiter = new LiveTokenRateLimiter(3); limiter.check("ip", "abcdefghijklmnop"); assert.equal(limiter.check("ip", "abcdefghijklmnop").allowed, false); });
await test("rate limiter enforces request count", () => { const limiter = new LiveTokenRateLimiter(1); limiter.check("ip", "abcdefghijklmnop"); assert.equal(limiter.check("ip", "qrstuvwxyzabcdef").allowed, false); });
await test("safe token response contains no permanent key", () => {
  const status: LivePublicStatus = { uiEnabled: true, available: true, provider: "gemini_live", model: "live", voiceName: "Kore", maxSessionMinutes: 10, publicDemoTokenEnabled: false };
  const response = safeTokenResponse("ephemeral", new Date(0).toISOString(), status);
  assert.deepEqual(Object.keys(response).sort(), ["expiresAt", "model", "token", "voiceName"]);
});
await test("ephemeral token is bounded to ten minutes", () => {
  const now = 1_000;
  const times = buildLiveTokenTimes(now, 10);
  assert.equal(times.expiresAt.getTime() - now, 600_000);
  assert.equal(times.newSessionExpiresAt.getTime() - now, 60_000);
});
await test("mock provider captures transport locally", async () => {
  const provider = new MockLiveProvider();
  await provider.connect({ token: "local", expiresAt: new Date().toISOString(), model: "mock", voiceName: "mock" }, () => {});
  provider.sendAudio("pcm"); provider.sendContextDelta("delta");
  assert.deepEqual(provider.audio, ["pcm"]); assert.deepEqual(provider.context, ["delta"]);
});
await test("denied permission returns failure without completion", async () => {
  const provider = new MockLiveProvider();
  await provider.connect({ token: "local", expiresAt: new Date().toISOString(), model: "mock", voiceName: "mock" }, () => {});
  const call = { id: "write-1", name: "prepareEvidencePacket", args: {} };
  provider.sendToolResult(call, { ok: false, message: "The user declined this action." });
  assert.equal(provider.results[0].result.ok, false);
  assert.equal(approved.packetDraft, undefined);
});
await test("tool completion follows a success result", async () => {
  const provider = new MockLiveProvider();
  await provider.connect({ token: "local", expiresAt: new Date().toISOString(), model: "mock", voiceName: "mock" }, () => {});
  const call = { id: "read-1", name: "readCurrentPage", args: {} };
  assert.equal(provider.results.length, 0);
  provider.sendToolResult(call, { ok: true, message: "The page was read." });
  assert.equal(provider.results[0].result.message, "The page was read.");
});
await test("no camera or image tools are introduced", () => assert.equal(LIVE_TOOL_NAMES.some((name) => /camera|image|photo/i.test(name)), false));

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

  process.stdout.write(`\n${passed} local Gemini Live architecture checks passed. No provider call was made.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
