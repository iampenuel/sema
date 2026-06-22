import { GoogleGenAI, Modality, type Session } from "@google/genai";
import type { AgentAction } from "@/lib/agent/agentTypes";
import { generateStructuredSummary } from "@/lib/packet/buildPacket";
import { createEmptySession } from "@/lib/sema-session/defaults";
import type { SemaSession } from "@/lib/sema-session/types";
import { getLiveConfig } from "../liveConfig";
import type { LiveToolCall } from "../liveTypes";
import {
  WRITE_TOOL_PROBE_DECLARATIONS,
  classifyToollessTurn,
  createConfirmationRequiredResponse,
  createWriteRequestRealtimeInput,
  evaluateCanonicalWritePermission,
  hasEarlyCompletionClaim,
  isConfirmationRequiredAcknowledgement,
  sanitizeWriteProbeEvent,
  validateCanonicalWriteAction,
  validateDedicatedWriteCall
} from "./writeToolProbeCore";
import { mintGeminiLiveWriteToolProbeToken } from "./writeToolProbeToken";
import type {
  SanitizedWriteProbeEvent,
  SanitizedWriteProbeEventRecord,
  WriteToolProbeConfiguration,
  WriteToolProbeDriver,
  WriteToolProbeErrorCode
} from "./writeToolProbeTypes";
import type { WriteProbeLifecycleEvent } from "./probeEventProtocol";

class Deferred<T> {
  readonly promise: Promise<T>;
  private settled = false;
  private resolvePromise!: (value: T) => void;
  private rejectPromise!: (error: Error) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    void this.promise.catch(() => {});
  }

  resolve(value: T) { if (!this.settled) { this.settled = true; this.resolvePromise(value); } }
  reject(error: Error) { if (!this.settled) { this.settled = true; this.rejectPromise(error); } }
  cancel() { this.reject(probeError("unknown_error", "Write-tool probe cleaned up")); }
}

function probeError(code: WriteToolProbeErrorCode, message: string) {
  return Object.assign(new Error(message), { code });
}

export class GeminiWriteToolProbeDriver implements WriteToolProbeDriver {
  private readonly startedAt = Date.now();
  private configuration?: WriteToolProbeConfiguration;
  private token?: string;
  private session?: Session;
  private localSession: SemaSession = createEmptySession();
  private sessionSnapshot = "";
  private calls: LiveToolCall[] = [];
  private call?: LiveToolCall;
  private action?: AgentAction;
  private acknowledgementText = "";
  private events: SanitizedWriteProbeEventRecord[] = [];
  private writePromptSent = false;
  private toolResponseSent = false;
  private modelOutputBeforeTool = false;
  private turnActive = false;
  private acceptEvents = true;
  private closeRequested = false;
  private socketClosed = false;
  private cleanupCompleted = false;

  constructor(
    private readonly signal?: AbortSignal,
    private readonly onLifecycle?: (event: WriteProbeLifecycleEvent, toolName?: string) => void,
    private readonly onFatal?: () => void
  ) {
    this.signal?.addEventListener("abort", () => {
      this.acceptEvents = false;
      this.rejectPending(probeError("child_global_timeout", "Write-tool probe aborted"));
      if (this.session && !this.closeRequested) { this.closeRequested = true; this.session.close(); }
    }, { once: true });
  }

  private setupComplete = new Deferred<void>();
  private writeToolCall = new Deferred<void>();
  private permissionAcknowledgement = new Deferred<void>();
  private closed = new Deferred<void>();
  private deferreds = [this.setupComplete, this.writeToolCall, this.permissionAcknowledgement];

  private record(event: SanitizedWriteProbeEvent, details: Omit<SanitizedWriteProbeEventRecord, "event" | "elapsedMs"> = {}) {
    if (!this.acceptEvents && event !== "cleanup_complete") return;
    this.events.push(sanitizeWriteProbeEvent({ event, elapsedMs: Date.now() - this.startedAt, ...details }));
  }

  private rejectPending(error: Error) {
    for (const deferred of this.deferreds) deferred.reject(error);
  }

  async initialize() {
    const story = "A synthetic write-tool permission test story.";
    this.localSession.story = { rawText: story, structuredSummary: generateStructuredSummary(story), summaryStatus: "approved" };
    this.localSession.folderStatus.story = "saved";
    this.sessionSnapshot = JSON.stringify(this.localSession);
  }

  async loadConfiguration() {
    const config = getLiveConfig();
    this.configuration = { provider: "gemini_live", model: config.model, voice: config.voiceName, fallbackUsed: false };
    return this.configuration;
  }

  async createEphemeralToken() {
    const minted = await mintGeminiLiveWriteToolProbeToken();
    if (this.signal?.aborted) throw probeError("child_global_timeout", "Probe aborted during token creation");
    this.token = minted.token;
    this.onLifecycle?.("token_created");
  }

  async openSocket() {
    if (!this.token || !this.configuration) throw new Error("Write-tool probe token or configuration is missing");
    const client = new GoogleGenAI({ apiKey: this.token, httpOptions: { apiVersion: "v1alpha" } });
    this.session = await client.live.connect({
      model: this.configuration.model,
      callbacks: {
        onopen: () => { this.record("socket_open"); this.onLifecycle?.("socket_open"); },
        onmessage: (message) => {
          if (!this.acceptEvents) return;
          if (message.setupComplete) {
            this.record("setup_complete");
            this.onLifecycle?.("setup_complete");
            this.setupComplete.resolve();
          }

          const functionCalls = message.toolCall?.functionCalls ?? [];
          if (functionCalls.length) {
            for (const providerCall of functionCalls) {
              const call: LiveToolCall = { id: providerCall.id ?? "", name: providerCall.name ?? "", args: providerCall.args ?? {} };
              this.calls.push(call);
              this.record(call.name === "prepareEvidencePacket" ? "tool_call_received" : "unexpected_tool_received", {
                toolName: call.name || "missing",
                functionCallCount: functionCalls.length
              });
              this.onLifecycle?.("tool_call_received", call.name || "missing");
            }
            this.turnActive = false;
            this.writeToolCall.resolve();
          }

          if (message.data) {
            this.record("server_audio_received");
            if (!this.calls.length) this.modelOutputBeforeTool = true;
          }

          const transcript = message.serverContent?.outputTranscription?.text;
          if (transcript) {
            this.record("output_transcript_received", { transcriptCharacterCount: transcript.length });
            if (!this.calls.length) this.modelOutputBeforeTool = true;
            if (this.toolResponseSent) this.acknowledgementText += transcript;
          }

          if (message.toolCallCancellation?.ids?.length) {
            this.record("tool_call_cancelled", { functionCallCount: message.toolCallCancellation.ids.length });
            this.writeToolCall.reject(probeError("provider_error", "Provider cancelled the write-tool call"));
          }

          if (message.serverContent?.turnComplete) {
            this.record("turn_complete_received");
            this.turnActive = false;
            if (this.toolResponseSent) {
              if (this.acknowledgementText.trim()) this.permissionAcknowledgement.resolve();
              else this.permissionAcknowledgement.reject(probeError("permission_acknowledgement_timeout", "Permission acknowledgement had no transcription"));
            } else if (!this.calls.length) {
              const code = classifyToollessTurn(this.modelOutputBeforeTool);
              this.writeToolCall.reject(probeError(code, "Provider completed without the expected write tool"));
            }
          }
        },
        onerror: (event) => {
          if (!this.acceptEvents) return;
          this.record("provider_error_received");
          const message = event.message || "Gemini Live provider error";
          const code = /429|resource_exhausted|rate.?limit/i.test(message) ? "rate_limited" : "provider_error";
          this.rejectPending(probeError(code, "Gemini Live provider error"));
          this.onFatal?.();
        },
        onclose: () => {
          this.socketClosed = true;
          this.record("socket_closed");
          this.closed.resolve();
          if (!this.closeRequested && this.acceptEvents) {
            this.rejectPending(probeError("socket_closed_early", "Socket closed before probe completion"));
            this.onFatal?.();
          }
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: [...WRITE_TOOL_PROBE_DECLARATIONS] }]
      }
    });
  }

  async dispatchSetup() { this.record("setup_sent"); }
  async waitForSetupComplete() { await this.setupComplete.promise; }

  async sendWriteRequest() {
    if (!this.session || this.turnActive || this.calls.length || this.toolResponseSent || this.acknowledgementText || this.modelOutputBeforeTool) {
      throw probeError("probe_not_idle_before_write_request", "Write request was not dispatched from an idle turn");
    }
    this.turnActive = true;
    this.writePromptSent = true;
    this.session.sendRealtimeInput(createWriteRequestRealtimeInput());
    this.record("write_prompt_sent");
    this.onLifecycle?.("write_prompt_sent");
  }

  async waitForWriteToolCall() {
    if (!this.writePromptSent) throw probeError("write_prompt_dispatch_failed", "Write prompt was not sent");
    await this.writeToolCall.promise;
  }

  async validateWriteToolCall() {
    if (this.calls.length !== 1) throw probeError("unexpected_tool_called", "Expected exactly one write-tool call");
    const call = this.calls[0];
    const validation = validateDedicatedWriteCall(call);
    if (!validation.ok) throw probeError(validation.code, "Write-tool call failed minimal payload validation");
    this.call = call;
    return call;
  }

  async checkCanonicalRegistry() {
    if (!this.call) throw probeError("canonical_action_missing", "Validated write-tool call is missing");
    this.action = validateCanonicalWriteAction(this.call, this.localSession);
    return this.action;
  }

  async evaluatePermissionGate() {
    if (!this.call || !this.action) throw probeError("permission_gate_incorrect", "Canonical action is missing");
    const result = evaluateCanonicalWritePermission(this.call, this.action);
    if (JSON.stringify(this.localSession) !== this.sessionSnapshot || this.localSession.packetDraft) {
      throw probeError("session_mutated_before_confirmation", "Session changed before visible confirmation");
    }
    return result;
  }

  async sendConfirmationRequiredResponse() {
    if (!this.session || !this.call) throw probeError("tool_response_failed", "Write-tool response prerequisites are missing");
    this.session.sendToolResponse(createConfirmationRequiredResponse(this.call));
    this.toolResponseSent = true;
    this.turnActive = true;
    this.onLifecycle?.("tool_response_sent");
  }

  async waitForPermissionAcknowledgement() { await this.permissionAcknowledgement.promise; }

  async validateNoEarlyCompletionClaim() {
    const text = this.acknowledgementText.trim();
    if (hasEarlyCompletionClaim(text)) throw probeError("early_completion_claim", "Provider claimed packet completion before permission");
    if (!isConfirmationRequiredAcknowledgement(text)) throw probeError("permission_acknowledgement_timeout", "Provider did not acknowledge screen confirmation");
    if (JSON.stringify(this.localSession) !== this.sessionSnapshot || this.localSession.packetDraft) {
      throw probeError("session_mutated_before_confirmation", "Session changed during permission acknowledgement");
    }
  }

  async closeSocket() {
    if (!this.session || this.socketClosed) { this.socketClosed = true; return; }
    if (!this.closeRequested) {
      this.closeRequested = true;
      this.session.close();
    }
    await this.closed.promise;
  }

  async cleanup() {
    if (this.cleanupCompleted) return { socketClosed: this.socketClosed, cleanupCompleted: true };
    this.acceptEvents = false;
    for (const deferred of this.deferreds) deferred.cancel();
    if (this.session && !this.closeRequested) {
      this.closeRequested = true;
      this.session.close();
    }
    this.session = undefined;
    this.token = undefined;
    this.acknowledgementText = "";
    this.calls = [];
    this.call = undefined;
    this.action = undefined;
    this.cleanupCompleted = true;
    this.record("cleanup_complete");
    this.onLifecycle?.("cleanup_complete");
    return { socketClosed: this.socketClosed, cleanupCompleted: true };
  }

  getSanitizedEvents() { return this.events.map((event) => ({ ...event })); }
}
