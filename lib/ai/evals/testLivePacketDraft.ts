import assert from "node:assert/strict";
import { PacketAIDraftSchema } from "@/lib/ai/aiSchemas";
import { GeminiAIProviderCore } from "@/lib/ai/providers/geminiProviderCore";
import { assessPacketDraft } from "@/lib/ai/validators/validatePacketDraft";
import { preflightGeminiModel } from "@/lib/ai/modelPreflight";
import { buildEvidencePacket } from "@/lib/packet/buildPacket";
import { fingerprintApprovedSessionContent } from "@/lib/packet/approvedContent";
import { createPacketReviewDraft } from "@/lib/packet/reviewDraft";
import { semaSessionReducer } from "@/lib/sema-session/reducer";
import { loadTestEnvironment } from "./loadTestEnvironment";
import { PACKET_APPROVED_CONTENT, PACKET_PATIENT_WORDS, PACKET_TEST_SESSION } from "./fixtures/packetDraftFixture";

type PacketReport = {
  test: "packet_drafting";
  passed: boolean;
  provider: "gemini";
  model: string;
  latencyMs?: number;
  fallbackUsed: boolean;
  requestId?: string;
  schemaValid: boolean;
  contentBoundaryValid: boolean;
  safetyValid: boolean;
  reviewStatusValid: boolean;
  deterministicBoundaryValid: boolean;
  errorCode?: string;
};

function report(value: PacketReport) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  loadTestEnvironment();
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.SEMA_AI_MODEL || "gemini-3.5-flash";
  if (!apiKey) {
    report({ test: "packet_drafting", passed: false, provider: "gemini", model, fallbackUsed: false, schemaValid: false, contentBoundaryValid: false, safetyValid: false, reviewStatusValid: false, deterministicBoundaryValid: false, errorCode: "configuration_missing" });
    process.stderr.write("PACKET_LIVE_VERIFICATION_FAILED: Gemini is not configured. Rerun with: npm run test:ai:live:packet\n");
    process.exitCode = 2;
    return;
  }

  const timeoutMs = Number(process.env.SEMA_AI_TIMEOUT_MS || 15000);
  const preflight = await preflightGeminiModel({ apiKey, model, timeoutMs });
  if (!preflight.ok) {
    report({ test: "packet_drafting", passed: false, provider: "gemini", model, latencyMs: preflight.latencyMs, fallbackUsed: false, schemaValid: false, contentBoundaryValid: false, safetyValid: false, reviewStatusValid: false, deterministicBoundaryValid: false, errorCode: preflight.errorCode });
    process.stderr.write("PACKET_LIVE_VERIFICATION_FAILED: Model preflight did not pass. Rerun with: npm run test:ai:live:packet\n");
    process.exitCode = 1;
    return;
  }

  const provider = new GeminiAIProviderCore({ apiKey, model, timeoutMs });
  const result = await provider.draftPacketContent({ approvedSessionContent: PACKET_APPROVED_CONTENT });
  const schemaValid = PacketAIDraftSchema.safeParse(result.data).success;
  const assessment = assessPacketDraft(result.data, PACKET_APPROVED_CONTENT);
  let reviewStatusValid = false;
  let deterministicBoundaryValid = false;

  if (result.ok && result.data && schemaValid && assessment.contentBoundaryValid && assessment.safetyValid) {
    const reviewDraft = createPacketReviewDraft(result.data, result.metadata.provider, fingerprintApprovedSessionContent(PACKET_APPROVED_CONTENT));
    const withReview = semaSessionReducer(PACKET_TEST_SESSION, { type: "set_packet_narrative_draft", draft: reviewDraft });
    reviewStatusValid = withReview.packetNarrativeDraft?.status === "needs_review" && buildEvidencePacket(withReview).organizedNarrative === undefined;
    const approved = semaSessionReducer(withReview, { type: "approve_packet_narrative_draft" });
    const buildOptions = { now: new Date("2026-01-02T00:00:00.000Z"), id: "packet-synthetic-fixed" };
    const first = buildEvidencePacket(approved, buildOptions);
    const second = buildEvidencePacket(approved, buildOptions);
    deterministicBoundaryValid = JSON.stringify(first) === JSON.stringify(second)
      && first.patientWords === PACKET_PATIENT_WORDS
      && first.organizedNarrative === result.data.conciseNarrative
      && !first.audioSignals.some((signal) => "objectUrl" in signal || "waveformPeaks" in signal);
  }

  const passed = result.ok
    && result.metadata.provider === "gemini"
    && result.metadata.fallbackUsed === false
    && schemaValid
    && assessment.contentBoundaryValid
    && assessment.safetyValid
    && reviewStatusValid
    && deterministicBoundaryValid;
  report({ test: "packet_drafting", passed, provider: "gemini", model, latencyMs: result.metadata.latencyMs, fallbackUsed: result.metadata.fallbackUsed, requestId: result.metadata.requestId, schemaValid, contentBoundaryValid: assessment.contentBoundaryValid, safetyValid: assessment.safetyValid, reviewStatusValid, deterministicBoundaryValid, errorCode: result.error?.code });
  assert.equal(passed, true, `Real Gemini packet drafting failed: ${result.error?.code ?? "validation_failed"}`);
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    process.stderr.write(`PACKET_LIVE_VERIFICATION_FAILED: ${error instanceof Error ? error.message : "unknown error"}\nRerun with: npm run test:ai:live:packet\n`);
    process.exit(1);
  }
);
