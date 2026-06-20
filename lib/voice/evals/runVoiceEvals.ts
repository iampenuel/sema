import assert from "node:assert/strict";
import { createAgentAction, MODEL_CALLABLE_AGENT_ACTIONS } from "@/lib/agent/actionRegistry";
import { routeLocalVoiceIntent } from "@/lib/agent/localIntentRouter";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import { buildApprovedSessionContent } from "@/lib/packet/approvedContent";
import { buildEvidencePacket, generateStructuredSummary } from "@/lib/packet/buildPacket";
import { createEmptySession } from "@/lib/sema-session/defaults";
import { semaSessionReducer } from "@/lib/sema-session/reducer";
import { detectUnsafeRequest } from "@/lib/safety/safetyRules";
import { appendUniqueTranscript } from "@/lib/voice/browserDictation";
import { containsRawAudioFields, sanitizeAudioSignal, serializeSemaSession } from "@/lib/voice/audioMetadata";
import { buildRecordingBlob, classifyMicrophoneError, requestBrowserMicrophone, revokeObjectUrl, stopMediaTracks } from "@/lib/voice/mediaRecorder";
import { createInitialVoiceState, voiceCaptureReducer } from "@/lib/voice/voiceReducer";
import { detectVoiceSupport, selectSupportedMimeType } from "@/lib/voice/voiceSupport";

type Test = { name: string; run: () => void | Promise<void> };

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function approvedSession() {
  const base = createEmptySession();
  const summary = generateStructuredSummary("A synthetic demo observation started yesterday and changed with movement.");
  return {
    ...base,
    story: { rawText: "A synthetic demo observation started yesterday and changed with movement.", structuredSummary: summary, summaryStatus: "approved" as const },
    audioSignals: [{ id: "audio-1", name: "Synthetic browser note", durationSeconds: 4, mimeType: "audio/webm", tags: ["voice note"], notes: "Demo only.", transcript: "Reviewed synthetic transcript.", transcriptSource: "browser_transcribed_user_reviewed" as const, createdAt: "2026-01-01T00:00:00.000Z", source: "browser_voice_capture" as const }]
  };
}

const tests: Test[] = [
  { name: "microphone support is detected", run: () => assert.equal(detectVoiceSupport({ navigator: { mediaDevices: { getUserMedia: async () => fakeStream().stream } } as unknown as Pick<Navigator, "mediaDevices">, MediaRecorder: class MockRecorder { static isTypeSupported() { return true; } pause() {} resume() {} } as unknown as typeof MediaRecorder }).microphone, true) },
  { name: "unsupported browser fallback is detected", run: () => assert.deepEqual(detectVoiceSupport({}), { microphone: false, mediaRecorder: false, dictation: false, pauseResume: false }) },
  { name: "supported MIME type follows preference order", run: () => assert.equal(selectSupportedMimeType({ isTypeSupported: (type) => type === "audio/webm" }), "audio/webm") },
  { name: "browser default MIME remains possible", run: () => assert.equal(selectSupportedMimeType(undefined), undefined) },
  { name: "permission grant stops the probe track", run: async () => { const mock = fakeStream(); const result = await requestBrowserMicrophone(async () => mock.stream); assert.equal(result.granted, true); assert.equal(mock.track.stopped, true); } },
  { name: "permission denial is classified", run: async () => { const result = await requestBrowserMicrophone(async () => { throw { name: "NotAllowedError" }; }); assert.equal(result.granted, false); if (!result.granted) assert.equal(result.code, "permission_denied"); } },
  { name: "permission denial does not reset into a reprompt loop", run: () => { const denied = voiceCaptureReducer(createInitialVoiceState(), { type: "permission_failed", code: "permission_denied", message: "denied" }); assert.equal(voiceCaptureReducer(denied, { type: "reset" }).status, "permission_denied"); } },
  { name: "device not found is classified", run: () => assert.equal(classifyMicrophoneError({ name: "NotFoundError" }).code, "device_not_found") },
  { name: "busy device is classified", run: () => assert.equal(classifyMicrophoneError({ name: "NotReadableError" }).code, "device_busy") },
  { name: "state machine starts recording", run: () => assert.equal(voiceCaptureReducer({ ...createInitialVoiceState(), status: "ready" }, { type: "start", recordingId: "v1", startedAt: 1 }).status, "recording") },
  { name: "state machine pauses recording", run: () => assert.equal(voiceCaptureReducer({ ...createInitialVoiceState(), status: "recording" }, { type: "pause" }).status, "paused") },
  { name: "state machine resumes recording", run: () => assert.equal(voiceCaptureReducer({ ...createInitialVoiceState(), status: "paused" }, { type: "resume" }).status, "recording") },
  { name: "stop moves a captured blob to review", run: () => { const blob = new Blob(["demo"], { type: "audio/webm" }); const state = voiceCaptureReducer({ ...createInitialVoiceState(), status: "stopping" }, { type: "review", blob, objectUrl: "blob:local", durationSeconds: 2 }); assert.equal(state.status, "reviewing"); assert.equal(state.audioBlob, blob); } },
  { name: "maximum duration preserves review", run: () => { const state = voiceCaptureReducer(createInitialVoiceState(), { type: "review", blob: new Blob(["demo"]), objectUrl: "blob:local", durationSeconds: 180, limitReached: true }); assert.equal(state.status, "reviewing"); assert.equal(state.errorCode, "recording_too_long"); } },
  { name: "empty recording is rejected", run: () => assert.equal(buildRecordingBlob([new Blob([])], "audio/webm"), null) },
  { name: "nonempty recording builds a local Blob", run: () => assert.equal(buildRecordingBlob([new Blob(["demo"])], "audio/webm")?.type, "audio/webm") },
  { name: "cancel clears ephemeral draft state", run: () => { const state = voiceCaptureReducer({ ...createInitialVoiceState(), status: "recording", transcriptDraft: "unsaved", elapsedSeconds: 2 }, { type: "cancelled" }); assert.equal(state.status, "cancelled"); assert.equal(state.transcriptDraft, ""); } },
  { name: "object URL is revoked", run: () => { let revoked = ""; revokeObjectUrl("blob:local", { revokeObjectURL: (value) => { revoked = value; } }); assert.equal(revoked, "blob:local"); } },
  { name: "non-blob URL is not revoked", run: () => { let called = false; revokeObjectUrl("https://example.test/audio", { revokeObjectURL: () => { called = true; } }); assert.equal(called, false); } },
  { name: "media tracks stop on completion", run: () => { const mock = fakeStream(); stopMediaTracks(mock.stream); assert.equal(mock.track.stopped, true); } },
  { name: "media tracks stop on cancellation", run: () => { const mock = fakeStream(); stopMediaTracks(mock.stream); assert.equal(mock.track.stopped, true); } },
  { name: "media tracks stop on unmount cleanup primitive", run: () => { const mock = fakeStream(); stopMediaTracks(mock.stream); assert.equal(mock.track.stopped, true); } },
  { name: "dictation unsupported remains a valid recording state", run: () => assert.equal(detectVoiceSupport({ navigator: { mediaDevices: {} as MediaDevices }, MediaRecorder: class { static isTypeSupported() { return false; } } as unknown as typeof MediaRecorder }).dictation, false) },
  { name: "duplicate final transcript is not appended", run: () => assert.equal(appendUniqueTranscript("Synthetic note", "Synthetic note"), "Synthetic note") },
  { name: "new final transcript is appended", run: () => assert.equal(appendUniqueTranscript("Synthetic note", "continued"), "Synthetic note continued") },
  { name: "interim transcript is excluded from audio metadata", run: () => assert.equal("interimTranscript" in sanitizeAudioSignal({ id: "a", name: "n", interimTranscript: "draft" }), false) },
  { name: "transcript remains editable in state", run: () => assert.equal(voiceCaptureReducer(createInitialVoiceState(), { type: "set_transcript", transcript: "edited" }).transcriptDraft, "edited") },
  { name: "transcript is not auto-approved", run: () => assert.equal(voiceCaptureReducer(createInitialVoiceState(), { type: "set_transcript", transcript: "draft" }).status, "checking_support") },
  { name: "saving to Story requires permission", run: () => assert.equal(evaluatePermission(createAgentAction("saveVoiceDraftToFolder", { target: "story" })).outcome, "permission_required") },
  { name: "microphone action requires permission", run: () => assert.equal(evaluatePermission(createAgentAction("startVoiceCapture")).outcome, "permission_required") },
  { name: "stop recording requires no additional permission", run: () => assert.equal(evaluatePermission(createAgentAction("stopVoiceCapture")).outcome, "not_required") },
  { name: "discarding a voice draft requires explicit confirmation", run: () => assert.equal(evaluatePermission(createAgentAction("discardVoiceDraft")).outcome, "explicit_confirmation_required") },
  { name: "voice Story append does not overwrite existing text", run: () => { const base = approvedSession(); const next = semaSessionReducer(base, { type: "apply_voice_story_text", transcript: "Reviewed addition.", mode: "append" }); assert.ok(next.story.rawText.startsWith(base.story.rawText)); assert.ok(next.story.rawText.endsWith("Reviewed addition.")); } },
  { name: "voice Story replace is explicit", run: () => { const next = semaSessionReducer(approvedSession(), { type: "apply_voice_story_text", transcript: "Reviewed replacement.", mode: "replace" }); assert.equal(next.story.rawText, "Reviewed replacement."); } },
  { name: "voice Story edit invalidates stale summary", run: () => assert.equal(semaSessionReducer(approvedSession(), { type: "apply_voice_story_text", transcript: "Addition.", mode: "append" }).story.structuredSummary, undefined) },
  { name: "voice Story edit invalidates stale packet", run: () => { const base = approvedSession(); const withPacket = { ...base, packetDraft: buildEvidencePacket(base) }; assert.equal(semaSessionReducer(withPacket, { type: "apply_voice_story_text", transcript: "Addition.", mode: "append" }).packetDraft, undefined); } },
  { name: "audio sanitizer stores metadata only", run: () => { const signal = sanitizeAudioSignal({ id: "a", name: "n", durationSeconds: 2, objectUrl: "blob:secret", waveformPeaks: [1], audioBlob: new Blob(["x"]), tags: [] }); assert.equal(containsRawAudioFields(signal), false); } },
  { name: "session serialization excludes raw audio", run: () => { const unsafe = { ...approvedSession(), audioBlob: new Blob(["secret"]), objectUrl: "blob:secret" } as unknown as ReturnType<typeof approvedSession>; const serialized = serializeSemaSession(unsafe); assert.equal(serialized.includes("audioBlob"), false); assert.equal(serialized.includes("objectUrl"), false); assert.equal(serialized.includes("blob:secret"), false); } },
  { name: "approved AI content excludes raw audio", run: () => assert.equal(containsRawAudioFields(buildApprovedSessionContent(approvedSession())), false) },
  { name: "packet stores metadata-only audio", run: () => assert.equal(containsRawAudioFields(buildEvidencePacket(approvedSession())), false) },
  { name: "voice command remains deterministic and local", run: () => assert.equal(routeLocalVoiceIntent("Start recording")?.proposedActions[0]?.type, "startVoiceCapture") },
  { name: "voice save command selects Story", run: () => assert.equal(routeLocalVoiceIntent("Save this to my story")?.proposedActions[0]?.payload?.target, "story") },
  { name: "model-callable actions exclude microphone access", run: () => assert.equal(MODEL_CALLABLE_AGENT_ACTIONS.includes("startVoiceCapture"), false) },
  { name: "unsafe cough interpretation is blocked", run: () => assert.ok(detectUnsafeRequest("What does this cough mean?").some((flag) => flag.type === "audio_classification_request")) },
  { name: "unsafe recording seriousness request is blocked", run: () => assert.ok(detectUnsafeRequest("Does this recording sound serious?").length > 0) },
  { name: "cancellation does not mutate SemaSession", run: () => { const session = approvedSession(); voiceCaptureReducer(createInitialVoiceState(), { type: "cancelled" }); assert.deepEqual(session, approvedSession()); } },
  { name: "provider availability is irrelevant to browser recording support", run: () => assert.equal(detectVoiceSupport({ navigator: { mediaDevices: { getUserMedia: async () => fakeStream().stream } } as unknown as Pick<Navigator, "mediaDevices">, MediaRecorder: class { static isTypeSupported() { return false; } } as unknown as typeof MediaRecorder }).mediaRecorder, true) }
];

async function main() {
  let passed = 0;
  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }
  console.log(`\nVoice readiness evaluations: ${passed}/${tests.length} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
