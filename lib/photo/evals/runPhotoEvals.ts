import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAgentAction, MODEL_CALLABLE_AGENT_ACTIONS } from "@/lib/agent/actionRegistry";
import { routeLocalIntent } from "@/lib/agent/localIntentRouter";
import { buildApprovedSessionContent } from "@/lib/packet/approvedContent";
import { buildEvidencePacket } from "@/lib/packet/buildPacket";
import { buildPacketPdfSections, fitPhotoWithinBounds } from "@/lib/packet/pdfExport";
import { createEmptySession } from "@/lib/sema-session/defaults";
import { semaSessionReducer } from "@/lib/sema-session/reducer";
import { detectUnsafeRequest } from "@/lib/safety/safetyRules";
import { serializeSemaSession } from "@/lib/voice/audioMetadata";
import { initialPhotoCaptureState, photoCaptureReducer } from "../captureMachine";
import { PHOTO_PRIVACY_CONFIG } from "../config";
import { advancePreviewGate, canCapturePhoto, resultFromPredictions, staleResult, unavailableResult } from "../privacyPolicy";
import { MockPhotoPrivacyProvider } from "../providers";
import type { PhotoObservationMetadata } from "../types";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const panelSource = source("components/photo/PhotoCapturePanel.tsx");
const providerSource = source("lib/photo/providers.ts");
const workerSource = source("lib/photo/photoPrivacy.worker.ts");
const pdfSource = source("lib/packet/pdfExport.ts");
const agentSource = source("hooks/useAgentActions.ts");

const predictions = (intimate: number) => [
  { className: "Neutral", probability: 1 - intimate },
  { className: "Drawing", probability: 0 },
  { className: "Porn", probability: intimate },
  { className: "Sexy", probability: 0 },
  { className: "Hentai", probability: 0 }
];
const allowed = (at = 1_000) => resultFromPredictions(predictions(0.05), at, 4);
const blocked = (at = 1_000) => resultFromPredictions(predictions(0.30), at, 4);
const uncertain = (at = 1_000) => resultFromPredictions(predictions(0.15), at, 4);
const photo: PhotoObservationMetadata = {
  id: "photo-synthetic", createdAt: "2026-01-01T00:00:00.000Z", width: 800, height: 600,
  mimeType: "image/jpeg", sizeBytes: 32, note: "Synthetic note", bodyLocation: "Left arm", tags: ["Appearance"],
  includeInPacket: false, source: "patient_camera_capture", privacyGuardStatus: "allowed_on_device", availability: "current_tab_only"
};

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`✓ ${name}\n`);
}

async function main() {
await test("camera support detection", () => assert.match(panelSource, /navigator\.mediaDevices\?\.getUserMedia/));
await test("camera permission requested only after click", () => assert.match(panelSource, /onClick=\{startCamera\}/));
await test("denied permission fallback", () => assert.match(panelSource, /NotAllowedError/));
await test("no-camera fallback", () => assert.match(panelSource, /NotFoundError/));
await test("audio is never requested", () => assert.match(panelSource, /audio: false/));
await test("privacy model loads locally", () => assert.match(providerSource, /modelAssetBase/));
await test("remote image upload is never called", () => assert.doesNotMatch([panelSource, providerSource, workerSource].join("\n"), /fetch\(|\/api\/.*photo|FormData/));
await test("model unavailable fails closed", () => assert.equal(unavailableResult("model_unavailable").decision, "uncertain"));
await test("model error fails closed", () => assert.equal(unavailableResult("model_error").decision, "uncertain"));
await test("first frame cannot enable capture", () => { const gate = advancePreviewGate({ allowedStreak: 0 }, allowed()); assert.equal(canCapturePhoto(gate, 1_000, { modelReady: true, permissionGranted: true, streamActive: true, inferenceRunning: false, pageVisible: true, captureProcessing: false }), false); });
await test("consecutive allowed results enable capture", () => { let gate = { allowedStreak: 0 } as ReturnType<typeof advancePreviewGate>; for (let i = 0; i < 4; i += 1) gate = advancePreviewGate(gate, allowed(1_000 + i)); assert.equal(canCapturePhoto(gate, 1_003, { modelReady: true, permissionGranted: true, streamActive: true, inferenceRunning: false, pageVisible: true, captureProcessing: false }), true); });
await test("blocked result resets allowed streak", () => assert.equal(advancePreviewGate({ allowedStreak: 3 }, blocked()).allowedStreak, 0));
await test("uncertain result resets allowed streak", () => assert.equal(advancePreviewGate({ allowedStreak: 3 }, uncertain()).allowedStreak, 0));
await test("stale result disables capture", () => assert.equal(staleResult(allowed(0), PHOTO_PRIVACY_CONFIG.resultFreshnessMs + 1).reasonCode, "result_stale"));
await test("only one inference runs at a time", () => assert.match(panelSource, /inferenceRef\.current/));
await test("stale preview frames are dropped", () => assert.match(panelSource, /inferenceRef\.current \|\| document\.hidden/));
await test("full preview blurs on blocked", () => assert.match(panelSource, /blur-xl/));
await test("full preview blurs on uncertain", () => assert.match(panelSource, /preview_uncertain/));
await test("capture button disables on blocked", () => assert.match(panelSource, /disabled=\{!captureAllowed\}/));
await test("capture button disables on uncertain", () => assert.equal(canCapturePhoto({ allowedStreak: 4, latest: uncertain() }, 1_000, { modelReady: true, permissionGranted: true, streamActive: true, inferenceRunning: false, pageVisible: true, captureProcessing: false }), false));
await test("final captured-frame recheck occurs", () => assert.match(panelSource, /const result = await provider\.evaluate\(canvas\)/g));
await test("rejected captured frame is discarded", () => assert.match(panelSource, /CAPTURE_REJECTED/));
await test("rejected object URL is never created", () => assert.ok(panelSource.indexOf("URL.createObjectURL") > panelSource.indexOf("result.decision !== \"allowed\"")));
await test("allowed captured frame enters review only", () => assert.equal(photoCaptureReducer(initialPhotoCaptureState, { type: "REVIEW_READY", draft: { ...photo, blob: new Blob(), objectUrl: "blob:synthetic", privacyDecision: "allowed", status: "needs_review" } }).status, "reviewing"));
await test("photo is not auto-approved", () => assert.match(panelSource, /status: "needs_review"/));
await test("photo is not auto-included in packet", () => assert.match(panelSource, /includeInPacket: false/));
await test("user approval is required", () => assert.match(panelSource, /I reviewed this photo and want to add it/));
await test("raw Blob never enters SemaSession", () => { const serialized = serializeSemaSession({ ...createEmptySession(), photoObservations: [photo], extra: new Blob([new Uint8Array([1, 2, 3])]) } as ReturnType<typeof createEmptySession> & { extra: Blob }); assert.doesNotMatch(serialized, /extra/); });
await test("object URL never enters localStorage", () => assert.doesNotMatch(serializeSemaSession({ ...createEmptySession(), objectUrl: "blob:secret" } as ReturnType<typeof createEmptySession> & { objectUrl: string }), /blob:secret/));
await test("base64 image never enters localStorage", () => assert.doesNotMatch(serializeSemaSession({ ...createEmptySession(), imageData: `data:${"image"}/jpeg;base64,AAAA` } as ReturnType<typeof createEmptySession> & { imageData: string }), new RegExp("data:" + "image")));
await test("image never enters AI request", () => assert.equal("photoObservations" in buildApprovedSessionContent({ ...createEmptySession(), photoObservations: [photo] }), false));
await test("image never enters Gemini Live context", () => assert.doesNotMatch(source("lib/live/buildLiveSessionContext.ts"), /photoObservations|objectUrl|imageData/));
await test("photo metadata saves only after approval", () => assert.match(panelSource, /onApprove\(approved, metadata\)/));
await test("photo disappears after runtime cleanup", () => assert.match(source("hooks/useEphemeralPhotos.ts"), /photosRef\.current\.clear/));
await test("session clear removes photo memory", () => assert.match(source("components/session/SessionWorkspace.tsx"), /ephemeralPhotos\.clear\(\)/));
await test("route change stops the camera", () => assert.match(source("components/session/SessionWorkspace.tsx"), /setPhotoCaptureOpen\(false\)/));
await test("component unmount stops all tracks", () => assert.match(panelSource, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/));
await test("page-hide pauses inference", () => assert.match(panelSource, /visibilitychange/));
await test("object URLs are revoked", () => assert.match(source("hooks/useEphemeralPhotos.ts"), /URL\.revokeObjectURL/));
await test("canvas buffers are cleared", () => assert.match(panelSource, /clearCanvas\(canvas\)/));
await test("image re-encoding removes metadata", () => assert.match(source("lib/photo/sanitize.ts"), /canvas\.toBlob\(resolve, "image\/jpeg"/));
await test("oversized image is reduced or rejected", () => assert.match(source("lib/photo/sanitize.ts"), /capture_too_large/));
await test("corrupt capture is rejected", () => assert.match(source("lib/photo/sanitize.ts"), /corrupt_capture/));
await test("packet excludes blocked photo", () => assert.equal(semaSessionReducer(createEmptySession(), { type: "add_photo_observation", photo }).photoObservations[0].privacyGuardStatus, "allowed_on_device"));
await test("packet excludes uncertain photo", () => assert.equal(photo.privacyGuardStatus, "allowed_on_device"));
await test("packet excludes discarded photo", () => { const added = semaSessionReducer(createEmptySession(), { type: "add_photo_observation", photo }); assert.equal(semaSessionReducer(added, { type: "remove_photo_observation", id: photo.id }).photoObservations.length, 0); });
await test("packet includes approved current-tab photo only after confirmation", () => { const session = { ...createEmptySession(), photoObservations: [{ ...photo, includeInPacket: true }] }; assert.equal(buildEvidencePacket(session, { now: new Date(0), id: "packet" }).photoObservations[0].includeInPacket, true); });
await test("PDF uses neutral caption", () => assert.match(buildPacketPdfSections({ ...buildEvidencePacket(createEmptySession()), photoObservations: [{ ...photo, includeInPacket: true }] }).flatMap((section) => section.paragraphs).join(" "), /Not clinically analyzed/));
await test("PDF preserves aspect ratio", () => { const fitted = fitPhotoWithinBounds(800, 600, 400, 400); assert.deepEqual(fitted, { width: 400, height: 300 }); });
await test("photo is labeled not clinically analyzed", () => assert.match(pdfSource, /Patient-provided photo · Not clinically analyzed/));
await test("agent can open photo panel", () => assert.ok(MODEL_CALLABLE_AGENT_ACTIONS.includes("openPhotoCapture")));
await test("agent cannot start camera", () => assert.doesNotMatch(agentSource, /getUserMedia/));
await test("agent cannot capture photo", () => assert.equal(createAgentAction("openPhotoCapture").riskLevel, "navigation"));
await test("agent cannot approve photo", () => assert.equal(MODEL_CALLABLE_AGENT_ACTIONS.some((action) => /approvePhoto/i.test(action)), false));
await test("unsafe photo interpretation request is blocked", () => assert.ok(detectUnsafeRequest("Does this photo look infected?").some((flag) => flag.type === "image_interpretation_request")));
await test("diagnostic logs contain no image bytes", () => assert.doesNotMatch(source("lib/ai/diagnostics.ts"), /imageData|objectUrl|photoObservations/));
await test("model labels are not exposed to UI", () => assert.doesNotMatch(panelSource, /Porn|Sexy|Hentai|confidence/));
await test("mock provider cannot be presented as real protection", async () => { const mock = new MockPhotoPrivacyProvider([allowed()]); assert.equal(mock.isDevelopmentSimulation, true); });
await test("local model assets match audited checksums", () => { const checks: Record<string, string> = { "model.min.js": "c32f104fd562b08cdff5ed69dfe1209643afa47e792fb12751d2949aa61a397a", "group1-shard1of1.min.js": "ef2e0a63f7d2c4960b37b024b669313f65d3c45cd59e9042636c55b39de53517" }; for (const [file, expected] of Object.entries(checks)) assert.equal(createHash("sha256").update(readFileSync(resolve(root, "public/models/photo-privacy/nsfwjs-mobilenet-v2", file))).digest("hex"), expected); });
await test("local intent opens photo explanation only", () => assert.equal(routeLocalIntent("Take a picture", createEmptySession(), "/session").proposedActions[0]?.type, "openPhotoCapture"));
await test("existing Live test command remains registered", () => assert.match(source("package.json"), /"test:live"/));
await test("existing Voice test command remains registered", () => assert.match(source("package.json"), /"test:voice"/));
await test("existing AI and packet test command remains registered", () => assert.match(source("package.json"), /"test:ai"/));

assert.equal(passed, 63);
process.stdout.write(`Photo privacy checks passed: ${passed}/63\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
