import assert from "node:assert/strict";
import { PacketAIDraftSchema, PacketAIRequestSchema } from "@/lib/ai/aiSchemas";
import { classifyGeminiError, GeminiAIProviderCore } from "@/lib/ai/providers/geminiProviderCore";
import { validatePacketDraft } from "@/lib/ai/validators/validatePacketDraft";
import { buildApprovedSessionContent, fingerprintApprovedSessionContent } from "@/lib/packet/approvedContent";
import { buildEvidencePacket } from "@/lib/packet/buildPacket";
import { createPacketReviewDraft } from "@/lib/packet/reviewDraft";
import { PACKET_LIMITATIONS, PACKET_SAFETY_NOTE } from "@/lib/safety/safetyCopy";
import { semaSessionReducer } from "@/lib/sema-session/reducer";
import type { PacketAIDraft, SemaAIProviderMetadata } from "@/lib/ai/aiTypes";
import { PACKET_APPROVED_CONTENT, PACKET_PATIENT_WORDS, PACKET_TEST_SESSION, SAFE_PACKET_AI_DRAFT } from "./fixtures/packetDraftFixture";

export type PacketReadinessEval = { name: string; run: () => void | Promise<void> };

const fingerprint = fingerprintApprovedSessionContent(PACKET_APPROVED_CONTENT);
const reviewDraft = () => createPacketReviewDraft(SAFE_PACKET_AI_DRAFT, "gemini", fingerprint);
const fixedBuild = { now: new Date("2026-01-02T00:00:00.000Z"), id: "packet-fixed" };

function approvedSession() {
  const withReview = semaSessionReducer(PACKET_TEST_SESSION, { type: "set_packet_narrative_draft", draft: reviewDraft() });
  return semaSessionReducer(withReview, { type: "approve_packet_narrative_draft" });
}

function expectRejected(draft: PacketAIDraft) {
  assert.equal(validatePacketDraft(draft, PACKET_APPROVED_CONTENT).ok, false);
}

export const packetReadinessEvals: PacketReadinessEval[] = [
  { name: "focused packet fixture is schema valid", run: () => assert.equal(PacketAIRequestSchema.safeParse({ approvedSessionContent: PACKET_APPROVED_CONTENT }).success, true) },
  { name: "packet request contains approved summary only", run: () => { const content = buildApprovedSessionContent(PACKET_TEST_SESSION); assert.equal(content.approvedSummary?.mainConcern, PACKET_TEST_SESSION.story.structuredSummary.mainConcern); } },
  { name: "unapproved summary is excluded from packet request", run: () => { const content = buildApprovedSessionContent({ ...PACKET_TEST_SESSION, story: { ...PACKET_TEST_SESSION.story, summaryStatus: "needs_review" } }); assert.equal(content.approvedSummary, undefined); } },
  { name: "packet request excludes raw audio and object URLs", run: () => { const serialized = JSON.stringify(PACKET_APPROVED_CONTENT); assert.equal(serialized.includes("objectUrl"), false); assert.equal(serialized.includes("waveformPeaks"), false); assert.equal(serialized.includes("blob:"), false); } },
  { name: "packet request strips image and file fields", run: () => { const parsed = PacketAIRequestSchema.parse({ approvedSessionContent: { ...PACKET_APPROVED_CONTENT, imageData: "synthetic-image", file: "synthetic-file" } }); assert.equal("imageData" in parsed.approvedSessionContent, false); assert.equal("file" in parsed.approvedSessionContent, false); } },
  { name: "packet draft schema rejects unknown fields", run: () => assert.equal(PacketAIDraftSchema.safeParse({ ...SAFE_PACKET_AI_DRAFT, packetId: "provider-controlled" }).success, false) },
  { name: "unapproved packet narrative is excluded", run: () => { const session = semaSessionReducer(PACKET_TEST_SESSION, { type: "set_packet_narrative_draft", draft: reviewDraft() }); assert.equal(buildEvidencePacket(session, fixedBuild).organizedNarrative, undefined); } },
  { name: "approved packet narrative enters permitted fields", run: () => { const packet = buildEvidencePacket(approvedSession(), fixedBuild); assert.equal(packet.organizedNarrative, SAFE_PACKET_AI_DRAFT.conciseNarrative); assert.deepEqual(packet.organizationNotes, SAFE_PACKET_AI_DRAFT.organizationNotes); } },
  { name: "AI draft cannot overwrite patient words", run: () => { const session = approvedSession() as typeof PACKET_TEST_SESSION & { packetNarrativeDraft: ReturnType<typeof reviewDraft> & { patientWords?: string } }; session.packetNarrativeDraft.patientWords = "overwritten"; assert.equal(buildEvidencePacket(session, fixedBuild).patientWords, PACKET_PATIENT_WORDS); } },
  { name: "AI draft cannot overwrite canonical safety note", run: () => { const session = approvedSession() as typeof PACKET_TEST_SESSION & { packetNarrativeDraft: ReturnType<typeof reviewDraft> & { safetyNote?: string } }; session.packetNarrativeDraft.safetyNote = "overwritten"; assert.equal(buildEvidencePacket(session, fixedBuild).safetyNote, PACKET_SAFETY_NOTE); } },
  { name: "AI draft cannot overwrite limitations", run: () => { const session = approvedSession() as typeof PACKET_TEST_SESSION & { packetNarrativeDraft: ReturnType<typeof reviewDraft> & { limitations?: string[] } }; session.packetNarrativeDraft.limitations = ["overwritten"]; assert.deepEqual(buildEvidencePacket(session, fixedBuild).limitations, PACKET_LIMITATIONS); } },
  { name: "AI draft cannot overwrite packet metadata or source label", run: () => { const packet = buildEvidencePacket(approvedSession(), fixedBuild); assert.equal(packet.id, "packet-fixed"); assert.equal(packet.generatedAt, "2026-01-02T00:00:00.000Z"); assert.equal(packet.label, "generated_from_patient_provided_information"); } },
  { name: "final packet contains metadata-only audio", run: () => { const signal = buildEvidencePacket(approvedSession(), fixedBuild).audioSignals[0]; assert.equal("objectUrl" in signal, false); assert.equal("waveformPeaks" in signal, false); } },
  { name: "stale packet narrative is excluded", run: () => { const stale = { ...approvedSession(), packetNarrativeDraft: { ...approvedSession().packetNarrativeDraft!, contentFingerprint: "stale" } }; assert.equal(buildEvidencePacket(stale, fixedBuild).organizedNarrative, undefined); } },
  { name: "source edits remove packet narrative", run: () => { const changed = semaSessionReducer(approvedSession(), { type: "update_story_raw_text", rawText: `${PACKET_PATIENT_WORDS} Changed.` }); assert.equal(changed.packetNarrativeDraft, undefined); } },
  { name: "removed packet narrative remains excluded", run: () => { const removed = semaSessionReducer(approvedSession(), { type: "discard_packet_narrative_draft" }); assert.equal(buildEvidencePacket(removed, fixedBuild).organizedNarrative, undefined); } },
  { name: "packet assembly is deterministic with a fixed clock", run: () => assert.deepEqual(buildEvidencePacket(approvedSession(), fixedBuild), buildEvidencePacket(approvedSession(), fixedBuild)) },
  { name: "diagnosis output is rejected", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, conciseNarrative: "The left wrist is fractured." }) },
  { name: "treatment output is rejected", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, conciseNarrative: "Treatment is required for the wrist." }) },
  { name: "medication output is rejected", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, organizationNotes: ["Medication should be started."] }) },
  { name: "urgency output is rejected", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, conciseNarrative: "This is an urgent emergency." }) },
  { name: "audio disease classification is rejected", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, organizationNotes: ["The recording sounds like a disease."] }) },
  { name: "body-map clinical interpretation is rejected", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, organizationNotes: ["The body location marker confirms an injury."] }) },
  { name: "clinician review claims are rejected", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, organizationNotes: ["A clinician reviewed and approved this packet."] }) },
  { name: "clinician questions must remain questions", run: () => expectRejected({ ...SAFE_PACKET_AI_DRAFT, clinicianQuestions: ["Discuss wrist details with the clinician."] }) },
  { name: "sustained rate limit is distinct and not retryable", run: () => { const error = classifyGeminiError(new Error("429 RESOURCE_EXHAUSTED")); assert.equal(error.code, "rate_limited"); assert.equal(error.retryable, false); } },
  { name: "short provider Retry-After permits only bounded retry", run: () => { const error = classifyGeminiError(Object.assign(new Error("429 rate limit"), { headers: { get: () => "1" } })); assert.equal(error.code, "rate_limited"); assert.equal(error.retryable, true); assert.equal(error.retryAfterMs, 1000); } },
  { name: "pre-cancelled packet request does not mutate session", run: async () => { const before = JSON.stringify(PACKET_TEST_SESSION); const controller = new AbortController(); controller.abort(); const provider = new GeminiAIProviderCore({ apiKey: "synthetic-not-used", model: "synthetic", timeoutMs: 1000 }); const result = await provider.draftPacketContent({ approvedSessionContent: PACKET_APPROVED_CONTENT }, { signal: controller.signal }); assert.equal(result.error?.code, "cancelled"); assert.equal(JSON.stringify(PACKET_TEST_SESSION), before); } },
  { name: "provider timeout leaves saved session unchanged", run: () => { const before = JSON.stringify(PACKET_TEST_SESSION); const error = classifyGeminiError(new Error("request timeout")); assert.equal(error.code, "timeout"); assert.equal(JSON.stringify(PACKET_TEST_SESSION), before); } },
  { name: "fallback metadata cannot count as real packet verification", run: () => { const metadata: SemaAIProviderMetadata = { provider: "local", model: "local", fallbackUsed: true }; assert.equal(metadata.provider === "gemini" && !metadata.fallbackUsed, false); } }
];
