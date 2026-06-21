import { createAgentAction } from "@/lib/agent/actionRegistry";
import type { LiveToolCall } from "../liveTypes";
import type {
  SanitizedWriteProbeEventRecord,
  WriteToolProbeDriver,
  WriteToolProbeStage
} from "../write-tool-probe/writeToolProbeTypes";

export class FakeWriteToolProbeDriver implements WriteToolProbeDriver {
  calls: WriteToolProbeStage[] = [];
  cleanupCalls = 0;
  private events: SanitizedWriteProbeEventRecord[] = [];
  private readonly call: LiveToolCall = { id: "write-call-1", name: "prepareEvidencePacket", args: {} };

  constructor(private readonly options: { hangStage?: WriteToolProbeStage; failStage?: WriteToolProbeStage; fallbackUsed?: boolean } = {}) {}

  private async step(stage: WriteToolProbeStage) {
    this.calls.push(stage);
    if (this.options.failStage === stage) throw Object.assign(new Error(`Synthetic failure at ${stage}`), { code: stage === "opening_socket" ? "provider_error" : "unknown_error" });
    if (this.options.hangStage === stage) await new Promise<void>(() => {});
  }

  async initialize() { await this.step("initialization"); }
  async loadConfiguration() {
    await this.step("configuration");
    return { provider: "gemini_live" as const, model: "gemini-3.1-flash-live-preview", voice: "Kore", fallbackUsed: (this.options.fallbackUsed ?? false) as false };
  }
  async createEphemeralToken() { await this.step("creating_ephemeral_token"); }
  async openSocket() { await this.step("opening_socket"); this.events.push({ event: "socket_open", elapsedMs: 1 }); }
  async dispatchSetup() { await this.step("dispatching_setup"); this.events.push({ event: "setup_sent", elapsedMs: 2 }); }
  async waitForSetupComplete() { await this.step("waiting_for_setup_complete"); this.events.push({ event: "setup_complete", elapsedMs: 3 }); }
  async sendWriteRequest() { await this.step("sending_write_request"); this.events.push({ event: "write_prompt_sent", elapsedMs: 4 }); }
  async waitForWriteToolCall() { await this.step("waiting_for_write_tool_call"); this.events.push({ event: "tool_call_received", elapsedMs: 5, toolName: this.call.name, functionCallCount: 1 }); }
  async validateWriteToolCall() { await this.step("validating_write_tool_call"); return this.call; }
  async checkCanonicalRegistry() { await this.step("checking_canonical_registry"); return createAgentAction("prepareEvidencePacket"); }
  async evaluatePermissionGate() { await this.step("evaluating_permission_gate"); return { permissionRequired: true, actionExecuted: false as const, sessionMutated: false as const }; }
  async sendConfirmationRequiredResponse() { await this.step("sending_confirmation_required_response"); }
  async waitForPermissionAcknowledgement() { await this.step("waiting_for_permission_acknowledgement"); this.events.push({ event: "output_transcript_received", elapsedMs: 6, transcriptCharacterCount: 44 }); }
  async validateNoEarlyCompletionClaim() { await this.step("validating_no_early_completion_claim"); }
  async closeSocket() { await this.step("closing_session"); this.events.push({ event: "socket_closed", elapsedMs: 7 }); }
  async cleanup() {
    if (this.cleanupCalls) return { socketClosed: true, cleanupCompleted: true };
    await this.step("cleanup");
    this.cleanupCalls += 1;
    this.events.push({ event: "cleanup_complete", elapsedMs: 8 });
    return { socketClosed: true, cleanupCompleted: true };
  }
  getSanitizedEvents() { return this.events.map((event) => ({ ...event })); }
}
