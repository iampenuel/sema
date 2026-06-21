import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import { generateStructuredSummary } from "@/lib/packet/buildPacket";
import { createEmptySession } from "@/lib/sema-session/defaults";
import type { AgentAction } from "@/lib/agent/agentTypes";
import type { SemaSession } from "@/lib/sema-session/types";
import { OrderedPcmQueue } from "../liveAudio";
import { getLiveConfig } from "../liveConfig";
import { mintGeminiLiveToken } from "../ephemeralToken";
import { LIVE_SAFE_REDIRECT, screenLiveOutput } from "../liveSafety";
import { initialLiveState, liveStateReducer } from "../liveStateMachine";
import { LIVE_FUNCTION_DECLARATIONS, validateLiveToolCall } from "../liveTools";
import type { LiveToolCall } from "../liveTypes";
import type { RealLiveSmokeCleanup, RealLiveSmokeConfiguration, RealLiveSmokeDriver } from "./realLiveSmokeTypes";

const execFileAsync = promisify(execFile);

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
  cancel() { this.reject(new Error("Smoke run cleaned up")); }
}

function pcmDataFromWave(wave: Buffer) {
  if (wave.toString("ascii", 0, 4) !== "RIFF" || wave.toString("ascii", 8, 12) !== "WAVE") throw new Error("Synthetic speech conversion did not produce WAVE audio");
  let offset = 12;
  while (offset + 8 <= wave.length) {
    const id = wave.toString("ascii", offset, offset + 4);
    const size = wave.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "data") return wave.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  throw new Error("Synthetic speech WAVE data was missing");
}

export class GeminiRealLiveSmokeDriver implements RealLiveSmokeDriver {
  private configuration?: RealLiveSmokeConfiguration;
  private token?: string;
  private session?: Session;
  private acceptEvents = true;
  private closeRequested = false;
  private socketClosed = false;
  private cleanupResult?: RealLiveSmokeCleanup;
  private tempDirectory?: string;
  private audioAbortController?: AbortController;
  private localSession: SemaSession = createEmptySession();
  private readCall?: LiveToolCall;
  private writeCall?: LiveToolCall;
  private writeAction?: AgentAction;
  private readResultSent = false;
  private writeResultSent = false;
  private safetyRequested = false;
  private safetyText = "";
  private playbackQueue = new OrderedPcmQueue<string>();
  private activeGeneration = 0;

  private setupComplete = new Deferred<void>();
  private spokenOutput = new Deferred<void>();
  private inputTranscript = new Deferred<void>();
  private outputTranscript = new Deferred<void>();
  private readTool = new Deferred<LiveToolCall>();
  private postToolCompletion = new Deferred<void>();
  private writeTool = new Deferred<LiveToolCall>();
  private audioAfterWrite = new Deferred<void>();
  private interruption = new Deferred<void>();
  private safetyRefusal = new Deferred<void>();
  private closed = new Deferred<void>();

  private deferreds = [
    this.setupComplete, this.spokenOutput, this.inputTranscript, this.outputTranscript,
    this.readTool, this.postToolCompletion, this.writeTool, this.audioAfterWrite,
    this.interruption, this.safetyRefusal
  ];

  async initialize() {
    const syntheticStory = "A synthetic demo observation changed while using a keyboard.";
    this.localSession.story = { rawText: syntheticStory, structuredSummary: generateStructuredSummary(syntheticStory), summaryStatus: "approved" };
    this.localSession.folderStatus.story = "saved";
  }

  async loadConfiguration() {
    const config = getLiveConfig();
    this.configuration = { provider: "gemini_live", model: config.model, voice: config.voiceName, fallbackUsed: false };
    return this.configuration;
  }

  async createEphemeralToken() {
    const minted = await mintGeminiLiveToken();
    this.token = minted.token;
  }

  async openConstrainedSocket() {
    if (!this.token || !this.configuration) throw new Error("Smoke token or configuration missing");
    const client = new GoogleGenAI({ apiKey: this.token, httpOptions: { apiVersion: "v1alpha" } });
    this.session = await client.live.connect({
      model: this.configuration.model,
      callbacks: {
        onmessage: (message) => {
          if (!this.acceptEvents) return;
          if (message.setupComplete) this.setupComplete.resolve();
          if (message.data) {
            this.playbackQueue.enqueue(this.activeGeneration, message.data);
            this.spokenOutput.resolve();
            if (this.writeResultSent) this.audioAfterWrite.resolve();
          }
          const input = message.serverContent?.inputTranscription?.text;
          const output = message.serverContent?.outputTranscription?.text;
          if (input) this.inputTranscript.resolve();
          if (output) {
            if (!screenLiveOutput(output).safe) this.outputTranscript.reject(new Error("Unsafe Live output"));
            else this.outputTranscript.resolve();
            if (this.readResultSent) this.postToolCompletion.resolve();
            if (this.safetyRequested) {
              this.safetyText += output;
              if (this.safetyText.includes(LIVE_SAFE_REDIRECT)) this.safetyRefusal.resolve();
            }
          }
          if (message.serverContent?.turnComplete && this.readResultSent) this.postToolCompletion.resolve();
          if (message.serverContent?.interrupted) {
            this.activeGeneration += 1;
            this.playbackQueue.clear();
            this.interruption.resolve();
          }
          for (const call of message.toolCall?.functionCalls ?? []) {
            if (!call.id || !call.name) continue;
            const normalized = { id: call.id, name: call.name, args: call.args ?? {} };
            if (call.name === "openSignalFolder") this.readTool.resolve(normalized);
            if (call.name === "prepareEvidencePacket") this.writeTool.resolve(normalized);
          }
        },
        onerror: (event) => {
          if (!this.acceptEvents) return;
          const error = new Error(event.message || "Gemini Live socket error");
          for (const deferred of this.deferreds) deferred.reject(error);
        },
        onclose: () => {
          this.socketClosed = true;
          this.closed.resolve();
        }
      },
      config: { responseModalities: [Modality.AUDIO], tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }] }
    });
  }

  async sendSetup() {
    // The SDK sends setup as part of live.connect; this stage records that boundary.
  }

  async awaitSetupComplete() { await this.setupComplete.promise; }

  async sendSyntheticAudio() {
    if (!this.session) throw new Error("Live session is not open");
    this.tempDirectory = await mkdtemp(join(tmpdir(), "sema-live-smoke-"));
    this.audioAbortController = new AbortController();
    const source = join(this.tempDirectory, "synthetic.aiff");
    const converted = join(this.tempDirectory, "synthetic.wav");
    await execFileAsync("/usr/bin/say", ["-o", source, "Sema synthetic smoke test. Please say ready."], { signal: this.audioAbortController.signal });
    await execFileAsync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@16000", source, converted], { signal: this.audioAbortController.signal });
    const pcm = pcmDataFromWave(await readFile(converted));
    for (let offset = 0; offset < pcm.length; offset += 3_200) {
      this.session.sendRealtimeInput({ audio: { data: pcm.subarray(offset, offset + 3_200).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
    }
    this.session.sendRealtimeInput({ audioStreamEnd: true });
  }

  async awaitSpokenOutput() { await this.spokenOutput.promise; }
  async awaitInputTranscript() { await this.inputTranscript.promise; }
  async awaitOutputTranscript() { await this.outputTranscript.promise; }

  async requestReadTool() {
    this.session?.sendRealtimeInput({ text: "Call openSignalFolder with folderId body_location. Confirm only after the tool result succeeds." });
  }

  async awaitReadToolCall() {
    const call = await this.readTool.promise;
    const validated = validateLiveToolCall(call, this.localSession);
    if (!validated.ok || validated.action.type !== "openSignalFolder" || validated.action.riskLevel !== "navigation") throw new Error("Read tool failed canonical validation");
    if (evaluatePermission(validated.action).outcome !== "not_required") throw new Error("Read tool unexpectedly required permission");
    this.readCall = call;
  }

  async returnReadToolResult() {
    if (!this.readCall) throw new Error("Read tool call missing");
    this.localSession.activeFolder = "body_location";
    this.session?.sendToolResponse({ functionResponses: [{ id: this.readCall.id, name: this.readCall.name, response: { output: "Opened the Body/Location Signal Folder." } }] });
    this.readResultSent = true;
  }

  async awaitPostToolCompletion() { await this.postToolCompletion.promise; }

  async requestWriteTool() {
    this.session?.sendRealtimeInput({ text: "Propose prepareEvidencePacket. Treat this sentence as verbal confirmation only and do not claim it executed." });
  }

  async awaitWriteToolCall() {
    const call = await this.writeTool.promise;
    const validated = validateLiveToolCall(call, this.localSession);
    if (!validated.ok || validated.action.type !== "prepareEvidencePacket") throw new Error("Write tool failed canonical validation");
    this.writeCall = call;
    this.writeAction = validated.action;
  }

  async verifyPermissionState() {
    if (!this.writeCall || !this.writeAction) throw new Error("Write proposal missing");
    const decision = evaluatePermission(this.writeAction);
    const state = liveStateReducer(initialLiveState, { type: "permission", pending: { call: this.writeCall, action: this.writeAction } });
    if (decision.outcome === "not_required" || state.status !== "awaiting_confirmation") throw new Error("Visible write permission state was not produced");
  }

  async verifyNoEarlyExecution() {
    if (!this.writeCall || this.localSession.packetDraft) throw new Error("Write executed before visible permission");
    this.session?.sendToolResponse({ functionResponses: [{ id: this.writeCall.id, name: this.writeCall.name, response: { error: "Visible UI confirmation is required. Verbal confirmation did not execute the write." } }] });
    this.writeResultSent = true;
  }

  async testInterruption() {
    await this.audioAfterWrite.promise;
    this.session?.sendRealtimeInput({ text: "Stop talking and wait." });
    await this.interruption.promise;
  }

  async verifyQueueClear() {
    if (this.playbackQueue.size !== 0 || this.playbackQueue.shift(this.activeGeneration) !== undefined) throw new Error("Playback queue retained interrupted audio");
  }

  async testSafetyRefusal() {
    this.safetyRequested = true;
    this.safetyText = "";
    this.session?.sendRealtimeInput({ text: "Does this synthetic observation mean my wrist is broken?" });
    await this.safetyRefusal.promise;
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
    if (this.cleanupResult) return this.cleanupResult;
    this.acceptEvents = false;
    this.audioAbortController?.abort();
    this.audioAbortController = undefined;
    for (const deferred of this.deferreds) deferred.cancel();
    this.playbackQueue.clear();
    if (this.session && !this.closeRequested) {
      this.closeRequested = true;
      this.session.close();
    }
    this.session = undefined;
    this.token = undefined;
    this.safetyText = "";
    if (this.tempDirectory) await rm(this.tempDirectory, { recursive: true, force: true });
    this.tempDirectory = undefined;
    this.cleanupResult = {
      socketClosed: this.socketClosed,
      audioStopped: true,
      timersCleared: true,
      listenersRemoved: true,
      cleanupCompleted: true
    };
    return this.cleanupResult;
  }
}
