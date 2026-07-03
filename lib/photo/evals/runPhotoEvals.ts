import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AZURE_PHOTO_MODERATION_PROVIDER,
  azureAnalyzeUrl,
  classifyAzureSexualSeverity,
  getAzurePhotoModerationConfig,
  normalizeAzureEndpointRoot,
  parseAzureSexualSeverity,
  photoModerationStatus
} from "../azureModeration";
import {
  buildAzureAnalyzeBody,
  buildAzureAnalyzeUrl,
  normalizeRawBase64,
  parseAzureProviderError,
  providerErrorSummary,
  requestAzurePhotoModeration
} from "../azureRequest";
import { hasSupportedImageSignature, readImageDimensions, supportedModerationMimeType, supportedSmokeMimeType, validateModerationImageDimensions } from "../imageValidation";
import { shouldMirrorPreview } from "@/components/photo/PhotoCapturePanel";

const root = process.cwd();
let passed = 0;

async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

function jpeg(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
}

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

const panel = source("components/photo/PhotoCapturePanel.tsx");
const route = source("app/api/moderation/photo/route.ts");
const statusRoute = source("app/api/moderation/photo/status/route.ts");
const azureModule = source("lib/photo/azureModeration.ts");
const azureRequest = source("lib/photo/azureRequest.ts");
const azureLiveSmoke = source("lib/photo/evals/runAzurePhotoLiveSmoke.ts");
const aiClient = source("lib/ai/client.ts");
const liveProvider = source("lib/live/providers/geminiLiveProvider.ts");
const sessionHook = source("hooks/useSemaSession.ts");
const serializer = source("lib/voice/audioMetadata.ts");
const pdfExport = source("lib/packet/pdfExport.ts");
const packetPreview = source("components/packet/EvidencePacketPreview.tsx");
const motionFolder = source("components/session/MotionVisualSignalFolder.tsx");
const pkg = source("package.json");
const lock = source("package-lock.json");

async function main() {
await test("Azure moderation status is server-derived and minimal", () => {
  assert.deepEqual(photoModerationStatus({ SEMA_ENABLE_AZURE_PHOTO_MODERATION: "false" } as unknown as NodeJS.ProcessEnv), { available: false, provider: AZURE_PHOTO_MODERATION_PROVIDER });
});
await test("Azure moderation enables only with flag endpoint and key", () => {
  assert.equal(getAzurePhotoModerationConfig({ SEMA_ENABLE_AZURE_PHOTO_MODERATION: "true", AZURE_CONTENT_SAFETY_ENDPOINT: "https://example.cognitiveservices.azure.com", AZURE_CONTENT_SAFETY_KEY: "1234567890123456" } as unknown as NodeJS.ProcessEnv).enabled, true);
});
await test("Azure moderation rejects malformed endpoints", () => {
  assert.equal(getAzurePhotoModerationConfig({ SEMA_ENABLE_AZURE_PHOTO_MODERATION: "true", AZURE_CONTENT_SAFETY_ENDPOINT: "http://example.com", AZURE_CONTENT_SAFETY_KEY: "1234567890123456" } as unknown as NodeJS.ProcessEnv).enabled, false);
});
await test("Azure analyze URL uses requested API version", () => assert.match(azureAnalyzeUrl("https://example.com"), /api-version=2024-09-01$/));
await test("Azure endpoint accepts trailing slash", () => {
  assert.equal(normalizeAzureEndpointRoot("https://example.cognitiveservices.azure.com/"), "https://example.cognitiveservices.azure.com");
  assert.equal(buildAzureAnalyzeUrl("https://example.cognitiveservices.azure.com/"), "https://example.cognitiveservices.azure.com/contentsafety/image:analyze?api-version=2024-09-01");
});
await test("Azure endpoint accepts no trailing slash", () => {
  assert.equal(buildAzureAnalyzeUrl("https://example.cognitiveservices.azure.com"), "https://example.cognitiveservices.azure.com/contentsafety/image:analyze?api-version=2024-09-01");
});
await test("Azure endpoint strips accidental API path", () => {
  assert.equal(buildAzureAnalyzeUrl("https://example.cognitiveservices.azure.com/contentsafety/image:analyze"), "https://example.cognitiveservices.azure.com/contentsafety/image:analyze?api-version=2024-09-01");
});
await test("Azure endpoint with query is rejected", () => assert.equal(normalizeAzureEndpointRoot("https://example.cognitiveservices.azure.com?api-version=2024-09-01"), undefined));
await test("Raw Base64 is accepted for Azure body", () => assert.deepEqual(normalizeRawBase64("QUJDRA=="), "QUJDRA=="));
await test("Data URL Base64 is rejected safely", () => assert.equal(normalizeRawBase64("data:image/png;base64,QUJDRA=="), undefined));
await test("Valid Azure body uses exact request shape", () => {
  const body = buildAzureAnalyzeBody("QUJDRA==");
  assert.deepEqual(body, {
    image: { content: "QUJDRA==" },
    categories: ["Sexual"],
    outputType: "FourSeverityLevels"
  });
});
await test("Azure request helper posts exact categories and outputType", async () => {
  const result = await requestAzurePhotoModeration({
    endpoint: "https://example.cognitiveservices.azure.com",
    key: "1234567890123456",
    rawBase64: "QUJDRA==",
    config: { allowMax: 0, uncertainMax: 2, timeoutMs: 1000 },
    fetchImpl: async (_url, init) => {
      const parsed = JSON.parse(String(init?.body));
      assert.deepEqual(parsed.categories, ["Sexual"]);
      assert.equal(parsed.outputType, "FourSeverityLevels");
      return new Response(JSON.stringify({ categoriesAnalysis: [{ category: "Sexual", severity: 0 }] }), { status: 200 });
    }
  });
  assert.deepEqual(result, { ok: true, severity: 0, outcome: "allowed", requestId: undefined });
});
await test("Azure sanitized 400 extraction avoids sensitive payloads", async () => {
  const base64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0123456789";
  const response = new Response(JSON.stringify({ error: { code: "InvalidRequestBody", message: `bad image at https://example.cognitiveservices.azure.com using ${base64}` } }), {
    status: 400,
    headers: { "x-ms-error-code": "InvalidRequestBody", "x-ms-request-id": "req-123" }
  });
  const parsed = await parseAzureProviderError(response);
  const summary = JSON.stringify(providerErrorSummary(parsed, { width: 128, height: 128, byteLength: 321 }));
  assert.match(summary, /InvalidRequestBody/);
  assert.doesNotMatch(summary, /example\.cognitiveservices|QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo/);
  assert.match(summary, /"imageByteCount":321/);
});
await test("Severity 0 allows", () => assert.equal(classifyAzureSexualSeverity(0), "allowed"));
await test("Severity 2 is uncertain by default", () => assert.equal(classifyAzureSexualSeverity(2), "uncertain"));
await test("Severity 4 blocks", () => assert.equal(classifyAzureSexualSeverity(4), "blocked"));
await test("Severity 6 blocks", () => assert.equal(classifyAzureSexualSeverity(6), "blocked"));
await test("Missing Sexual result fails closed", () => assert.equal(parseAzureSexualSeverity({ categoriesAnalysis: [{ category: "Violence", severity: 0 }] }).ok, false));
await test("Duplicate Sexual result fails closed", () => assert.equal(parseAzureSexualSeverity({ categoriesAnalysis: [{ category: "Sexual", severity: 0 }, { category: "Sexual", severity: 2 }] }).ok, false));
await test("Malformed Azure response fails closed", () => assert.equal(parseAzureSexualSeverity({ categoriesAnalysis: [{ category: "Sexual", severity: 1 }] }).ok, false));
await test("Usable Sexual severity parses", () => assert.deepEqual(parseAzureSexualSeverity({ categoriesAnalysis: [{ category: "Sexual", severity: 0 }] }), { ok: true, severity: 0 }));

await test("Only JPEG moderation MIME is accepted", () => {
  assert.equal(supportedModerationMimeType("image/jpeg"), true);
  assert.equal(supportedModerationMimeType("image/png"), false);
});
await test("JPEG signature is validated", () => assert.equal(hasSupportedImageSignature(jpeg(64, 64), "image/jpeg"), true));
await test("Malformed signature is rejected", () => assert.equal(hasSupportedImageSignature(new Uint8Array([1, 2, 3]), "image/jpeg"), false));
await test("Dimensions are read without decoding pixels", () => assert.deepEqual(readImageDimensions(jpeg(640, 480), "image/jpeg"), { width: 640, height: 480 }));
await test("Dimensions below 50x50 reject", () => assert.equal(validateModerationImageDimensions(jpeg(49, 64), "image/jpeg").ok, false));
await test("Dimensions above 2048 reject", () => assert.equal(validateModerationImageDimensions(jpeg(2049, 64), "image/jpeg").ok, false));
await test("Valid Azure-sized dimensions pass", () => assert.equal(validateModerationImageDimensions(jpeg(1600, 1200), "image/jpeg").ok, true));
await test("Smoke PNG MIME is accepted for live smoke only", () => {
  assert.equal(supportedSmokeMimeType("image/png"), true);
  assert.equal(supportedModerationMimeType("image/png"), false);
});
await test("Smoke image below 50px rejects locally", () => assert.equal(validateModerationImageDimensions(pngHeader(49, 128), "image/png").ok, false));
await test("Smoke image above 2048px rejects locally", () => assert.equal(validateModerationImageDimensions(pngHeader(2049, 128), "image/png").ok, false));
await test("Smoke image above 4MB rejects locally", () => assert.match(azureLiveSmoke, /bytes\.byteLength > PHOTO_PRIVACY_CONFIG\.maximumBytes/));
await test("Malformed smoke image rejects locally", () => {
  const malformed = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(hasSupportedImageSignature(malformed, "image/png"), false);
  assert.equal(validateModerationImageDimensions(malformed, "image/png").ok, false);
});
await test("Valid 128x128 PNG dimensions pass locally", () => assert.deepEqual(readImageDimensions(pngHeader(128, 128), "image/png"), { width: 128, height: 128 }));

await test("Disclosure appears before browser camera permission", () => {
  assert.match(panel, /will be sent to Microsoft Azure/);
  assert.match(panel, /if \(!disclosureAccepted \|\| !moderationStatus\.available\) return/);
});
await test("Disclosure checkbox is unchecked by default", () => assert.match(panel, /useState\(false\)/));
await test("Declining disclosure cannot call getUserMedia", () => assert.match(panel, /if \(!disclosureAccepted \|\| !moderationStatus\.available\) return/));
await test("Camera permission is not requested automatically", () => {
  assert.match(panel, /async function startCamera\(\)[\s\S]*getUserMedia/);
  assert.equal((panel.match(/getUserMedia/g) ?? []).length, 3);
});
await test("Front camera preview is mirrored", () => assert.equal(shouldMirrorPreview({ requestedFacingMode: "user", reportedFacingMode: "user" }), true));
await test("Unknown desktop webcam defaults to mirrored preview", () => assert.equal(shouldMirrorPreview({ requestedFacingMode: "unspecified", reportedFacingMode: "unknown" }), true));
await test("Environment camera is unmirrored", () => assert.equal(shouldMirrorPreview({ requestedFacingMode: "user", reportedFacingMode: "environment" }), false));
await test("Requested environment is unmirrored", () => assert.equal(shouldMirrorPreview({ requestedFacingMode: "environment", reportedFacingMode: "unknown" }), false));
await test("Mirror toggle affects preview only", () => {
  assert.match(panel, /Mirror preview/);
  assert.match(panel, /scale-x-\[-1\]/);
  assert.doesNotMatch(panel, /context\.scale\(-1/);
});
await test("Capture canvas remains unmirrored", () => assert.match(panel, /context\.drawImage\(video, 0, 0, canvas\.width, canvas\.height\)/));
await test("Azure input remains the unmirrored sanitized capture", () => assert.match(panel, /moderatePhotoWithAzure\(\{ blob: sanitized\.blob/));
await test("Review image uses the sanitized object URL without CSS mirroring", () => assert.match(panel, /src=\{draft\.objectUrl\}[\s\S]*object-contain/));
await test("No continuous frame upload exists", () => {
  assert.doesNotMatch(panel, /setInterval/);
  assert.equal((panel.match(/moderatePhotoWithAzure\(\{/g) ?? []).length, 1);
});
await test("Exactly one moderation request path exists per capture", () => assert.equal((panel.match(/moderatePhotoWithAzure/g) ?? []).length, 2));
await test("Only one moderation request can be active", () => assert.match(panel, /activeModerationRef\.current/));
await test("Allowed photo is not auto-approved", () => assert.match(panel, /status: "needs_review"/));
await test("Allowed photo is not auto-included", () => assert.match(panel, /includeInPacket: false/));
await test("Approval checkbox copy is explicit", () => assert.match(panel, /I reviewed this photo and want to add it to this Sema session/));
await test("Blocked photo copy is neutral and does not expose Azure category or scores", () => {
  assert.match(panel + azureModule, /Photo blocked for privacy\\n\\nAutomated screening flagged this photo as potentially sensitive, so Sema cannot add it\. You can retake the photo or continue using text or the body map\./);
  assert.doesNotMatch(panel, /Sema cannot add this photo\. You can continue using text or the body map instead\.|Sexual|severity/i);
});
await test("AI photo-description UI is removed", () => assert.doesNotMatch(panel, /Gemini|photo description|Create neutral AI description|Send this photo/));

await test("Photo moderation route is POST-first", () => assert.match(route, /export async function POST/));
await test("Photo moderation GET rejects", () => assert.match(route, /export function GET\(\)[\s\S]*Use POST/));
await test("Photo moderation route uses no-store", () => assert.match(route, /Cache-Control.+no-store/));
await test("Server rejects multiple files", () => assert.match(route, /imageEntries\.length !== 1/));
await test("Server rejects files larger than 4 MB", () => assert.match(route, /PHOTO_PRIVACY_CONFIG\.maximumBytes/));
await test("Server rejects unsupported MIME", () => assert.match(route, /supportedModerationMimeType/));
await test("Server rejects malformed signatures", () => assert.match(route, /hasSupportedImageSignature/));
await test("Server validates dimensions", () => assert.match(route, /validateModerationImageDimensions/));
await test("Azure request analyzes Sexual only", () => assert.match(azureRequest, /categories: \["Sexual"\]/));
await test("Azure request uses FourSeverityLevels", () => assert.match(azureRequest, /FourSeverityLevels/));
await test("Smoke command loads .env.local", () => assert.match(azureLiveSmoke, /loadEnvConfig\(process\.cwd\(\)/));
await test("Real route uses shared Azure provider helper", () => assert.match(route, /requestAzurePhotoModeration/));
await test("Smoke command uses shared Azure provider helper", () => assert.match(azureLiveSmoke, /requestAzurePhotoModeration/));
await test("Smoke command never constructs data URL payloads", () => assert.doesNotMatch(azureLiveSmoke, /data:image|azureAnalyzeUrl|Ocp-Apim-Subscription-Key/));
await test("Shared Azure request helper does not log sensitive request material", () => assert.doesNotMatch(azureRequest, /console\.(?:log|info|warn|error)|process\.env/));
await test("Azure key stays server-side", () => {
  assert.match(azureModule, /AZURE_CONTENT_SAFETY_KEY/);
  assert.doesNotMatch(panel + aiClient, /AZURE_CONTENT_SAFETY_KEY|AZURE_CONTENT_SAFETY_ENDPOINT/);
});
await test("Azure status route returns provider availability only", () => {
  assert.match(statusRoute, /photoModerationStatus/);
  assert.doesNotMatch(statusRoute, /AZURE_CONTENT_SAFETY_KEY|AZURE_CONTENT_SAFETY_ENDPOINT/);
});
await test("Route does not return raw Azure severity", () => assert.doesNotMatch(route, /severity.*NextResponse\.json|categoriesAnalysis.*NextResponse\.json/));
await test("Route does not log base64 or provider body", () => assert.doesNotMatch(route, /console\.(?:log|info|warn|error)\([^)]*(base64|content|categoriesAnalysis|Ocp-Apim)/));
await test("Route zeroes temporary bytes", () => assert.match(route, /bytes\.fill\(0\)/));

await test("Gemini photo route was removed from client", () => assert.doesNotMatch(aiClient, /photo-description|describePhotoWithAI|FormData/));
await test("Gemini Live provider never sends image data", () => assert.doesNotMatch(liveProvider, /inlineData|image\/|photo-description/));
await test("Session migration strips legacy AI photo descriptions", () => assert.doesNotMatch(sessionHook, /sanitizeApprovedPhotoDescription|aiDescription:/));
await test("Serializer strips legacy image fields", () => assert.match(serializer, /aiDescription|base64|imageData|pixelBuffer/));
await test("Packet preview excludes AI image descriptions", () => assert.doesNotMatch(packetPreview, /AI-generated visual description|aiDescription/));
await test("PDF excludes AI image descriptions", () => assert.doesNotMatch(pdfExport, /AI-generated visual description|aiDescription/));
await test("Photo packet label includes screening and not-analyzed boundary", () => assert.match(pdfExport + packetPreview + motionFolder, /Passed automated content screening[\s\S]*Not clinically analyzed/));
await test("NSFWJS dependency is removed", () => assert.doesNotMatch(pkg + lock, /nsfwjs/));
await test("TensorFlow dependency is removed", () => assert.doesNotMatch(pkg + lock, /@tensorflow\/tfjs/));
await test("Local model worker is not referenced", () => assert.doesNotMatch(panel + source("components/session/SessionWorkspace.tsx"), /PhotoPrivacy|photoPrivacy|workerProvider|NSFWJS|TensorFlow/));
await test("Cloud photo description feature flag is gone from runtime code", () => assert.doesNotMatch(source("lib/ai/runtimeStatus.ts") + aiClient + panel, /SEMA_ENABLE_CLOUD_PHOTO_DESCRIPTION/));

console.log(`Photo evals passed: ${passed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
