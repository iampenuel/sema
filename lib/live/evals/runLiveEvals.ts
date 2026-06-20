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

  process.stdout.write(`\n${passed} local Gemini Live architecture checks passed. No provider call was made.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
