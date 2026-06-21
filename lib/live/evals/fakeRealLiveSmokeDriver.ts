import type { RealLiveSmokeCleanup, RealLiveSmokeConfiguration, RealLiveSmokeDriver, RealLiveSmokeStage } from "../real-smoke/realLiveSmokeTypes";

export class FakeRealLiveSmokeDriver implements RealLiveSmokeDriver {
  calls: RealLiveSmokeStage[] = [];
  cleanupCalls = 0;
  closed = false;
  lateSocketMutations = 0;
  lateAudioMutations = 0;
  lateTranscriptMutations = 0;
  cleanupResult: RealLiveSmokeCleanup = { socketClosed: true, audioStopped: true, timersCleared: true, listenersRemoved: true, cleanupCompleted: true };

  constructor(private readonly options: { hangStage?: RealLiveSmokeStage; failStage?: RealLiveSmokeStage; fallbackUsed?: boolean } = {}) {}

  private async step(stage: RealLiveSmokeStage) {
    this.calls.push(stage);
    if (this.options.failStage === stage) throw new Error(`Synthetic failure at ${stage}`);
    if (this.options.hangStage === stage) await new Promise<void>(() => {});
  }

  async initialize() { await this.step("initializing"); }
  async loadConfiguration(): Promise<RealLiveSmokeConfiguration> {
    await this.step("loading_configuration");
    return { provider: "gemini_live", model: "gemini-3.1-flash-live-preview", voice: "Kore", fallbackUsed: (this.options.fallbackUsed ?? false) as false };
  }
  async createEphemeralToken() { await this.step("creating_ephemeral_token"); }
  async openConstrainedSocket() { await this.step("opening_constrained_socket"); }
  async sendSetup() { await this.step("sending_setup"); }
  async awaitSetupComplete() { await this.step("awaiting_setup_complete"); }
  async sendSyntheticAudio() { await this.step("sending_synthetic_audio"); }
  async awaitSpokenOutput() { await this.step("awaiting_spoken_output"); }
  async awaitInputTranscript() { await this.step("awaiting_input_transcript"); }
  async awaitOutputTranscript() { await this.step("awaiting_output_transcript"); }
  async requestReadTool() { await this.step("requesting_read_tool"); }
  async awaitReadToolCall() { await this.step("awaiting_read_tool_call"); }
  async returnReadToolResult() { await this.step("returning_read_tool_result"); }
  async awaitPostToolCompletion() { await this.step("awaiting_post_tool_completion"); }
  async requestWriteTool() { await this.step("requesting_write_tool"); }
  async awaitWriteToolCall() { await this.step("awaiting_write_tool_call"); }
  async verifyPermissionState() { await this.step("verifying_permission_state"); }
  async verifyNoEarlyExecution() { await this.step("verifying_no_early_execution"); }
  async testInterruption() { await this.step("testing_interruption"); }
  async verifyQueueClear() { await this.step("verifying_queue_clear"); }
  async testSafetyRefusal() { await this.step("testing_safety_refusal"); }
  async closeSocket() { await this.step("closing_socket"); this.closed = true; }
  async cleanup() {
    if (this.cleanupCalls) return this.cleanupResult;
    await this.step("cleaning_up");
    this.cleanupCalls += 1;
    this.closed = true;
    return this.cleanupResult;
  }

  emitLateSocketEvent() { if (!this.closed) this.lateSocketMutations += 1; }
  emitLateAudio() { if (!this.closed) this.lateAudioMutations += 1; }
  emitLateTranscript() { if (!this.closed) this.lateTranscriptMutations += 1; }
}
