import { createDeterministicPcmFixture, validateSyntheticPcm } from "../real-smoke/syntheticPcm";
import type { RealLiveSmokeCleanup, RealLiveSmokeConfiguration, RealLiveSmokeDriver, RealLiveSmokeStage } from "../real-smoke/realLiveSmokeTypes";

export class FakeRealLiveSmokeDriver implements RealLiveSmokeDriver {
  calls: RealLiveSmokeStage[] = [];
  cleanupCalls = 0;
  closed = false;
  lateSocketMutations = 0;
  lateAudioMutations = 0;
  lateTranscriptMutations = 0;
  syntheticPcm?: Buffer;
  cleanupResult: RealLiveSmokeCleanup = { socketClosed: true, audioStopped: true, timersCleared: true, listenersRemoved: true, cleanupCompleted: true };

  constructor(private readonly options: {
    hangStage?: RealLiveSmokeStage;
    failStage?: RealLiveSmokeStage;
    fallbackUsed?: boolean;
    transcriptionReceived?: boolean;
  } = {}) {}

  private async step(stage: RealLiveSmokeStage) {
    this.calls.push(stage);
    if (this.options.failStage === stage) throw new Error(`Synthetic failure at ${stage}`);
    if (this.options.hangStage === stage) await new Promise<void>(() => {});
  }

  async initialize() { await this.step("initialization"); }
  async loadConfiguration(): Promise<RealLiveSmokeConfiguration> {
    await this.step("configuration");
    return { provider: "gemini_live", model: "gemini-3.1-flash-live-preview", voice: "Kore", fallbackUsed: (this.options.fallbackUsed ?? false) as false };
  }
  async prepareSyntheticAudio() { await this.step("preparing_synthetic_audio"); this.syntheticPcm = createDeterministicPcmFixture(); }
  async validateSyntheticAudio() { await this.step("validating_synthetic_audio"); if (!this.syntheticPcm) throw new Error("PCM missing"); return validateSyntheticPcm(this.syntheticPcm); }
  async createEphemeralToken() { await this.step("creating_ephemeral_token"); }
  async openConstrainedSocket() { await this.step("opening_constrained_socket"); }
  async dispatchSetup() { await this.step("dispatching_setup"); }
  async waitForSetupComplete() { await this.step("waiting_for_setup_complete"); }
  async dispatchSyntheticAudio() { await this.step("dispatching_synthetic_audio"); }
  async signalAudioEnd() { await this.step("signaling_audio_end"); }
  async sendTextAudioResponseProbe() { await this.step("sending_text_audio_response_probe"); }
  async waitForModelAudio() { await this.step("waiting_for_model_audio"); }
  async validateModelAudio() { await this.step("validating_model_audio"); }
  async validateTranscription() {
    await this.step("validating_transcription");
    return this.options.transcriptionReceived === false
      ? { received: false }
      : { received: true, characterCount: 14, safetyValid: true };
  }
  async testReadTool() { await this.step("testing_read_tool"); }
  async testWritePermission() { await this.step("testing_write_permission"); }
  async testInterruption() { await this.step("testing_interruption"); }
  async testSafetyRefusal() { await this.step("testing_safety_refusal"); }
  async closeSocket() { await this.step("closing_session"); this.closed = true; }
  async cleanup() {
    if (this.cleanupCalls) return this.cleanupResult;
    await this.step("cleanup");
    this.cleanupCalls += 1;
    this.closed = true;
    this.syntheticPcm = undefined;
    return this.cleanupResult;
  }

  emitLateSocketEvent() { if (!this.closed) this.lateSocketMutations += 1; }
  emitLateAudio() { if (!this.closed) this.lateAudioMutations += 1; }
  emitLateTranscript() { if (!this.closed) this.lateTranscriptMutations += 1; }
}
