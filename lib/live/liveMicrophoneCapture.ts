import { bytesToBase64, float32ToPcm16, LIVE_INPUT_SAMPLE_RATE, PcmChunkAccumulator, resampleFloat32 } from "./liveAudio";
import { LIVE_MICROPHONE_CONSTRAINTS } from "./liveTurnState";

export type LiveMicrophoneVoiceState =
  | "unavailable"
  | "permission_pending"
  | "ready_but_blocked"
  | "listening"
  | "muted"
  | "turn_closing"
  | "blocked_during_model_generation"
  | "blocked_during_playback"
  | "blocked_during_cooldown"
  | "stopped"
  | "error";

export type LiveMicrophoneBlockReason =
  | "not_listening"
  | "permission_not_granted"
  | "microphone_disabled"
  | "muted"
  | "stopped"
  | "model_output_active"
  | "playback_active"
  | "cooldown_active"
  | "completed_one_turn"
  | "permission_pending"
  | "action_running"
  | "none";

export type LiveMicrophoneForwardingGate = {
  voiceState: LiveMicrophoneVoiceState;
  microphonePermissionGranted: boolean;
  microphoneEnabled: boolean;
  muted: boolean;
  stopped: boolean;
  modelOutputActive: boolean;
  playbackActive: boolean;
  cooldownActive: boolean;
  completedOneTurn: boolean;
  permissionPending?: boolean;
  actionRunning?: boolean;
};

export type LiveMicrophoneForwardingDecision = {
  allowed: boolean;
  reason: LiveMicrophoneBlockReason;
};

export type LiveMicrophoneChunk = {
  data: string;
  byteLength: number;
  sampleRate: number;
};

export function canForwardPhase1CMicrophonePcm(gate: LiveMicrophoneForwardingGate): LiveMicrophoneForwardingDecision {
  if (gate.permissionPending) return { allowed: false, reason: "permission_pending" };
  if (gate.actionRunning) return { allowed: false, reason: "action_running" };
  if (gate.voiceState !== "listening") return { allowed: false, reason: "not_listening" };
  if (!gate.microphonePermissionGranted) return { allowed: false, reason: "permission_not_granted" };
  if (!gate.microphoneEnabled) return { allowed: false, reason: "microphone_disabled" };
  if (gate.muted) return { allowed: false, reason: "muted" };
  if (gate.stopped) return { allowed: false, reason: "stopped" };
  if (gate.completedOneTurn) return { allowed: false, reason: "completed_one_turn" };
  if (gate.modelOutputActive) return { allowed: false, reason: "model_output_active" };
  if (gate.playbackActive) return { allowed: false, reason: "playback_active" };
  if (gate.cooldownActive) return { allowed: false, reason: "cooldown_active" };
  return { allowed: true, reason: "none" };
}

export class LiveMicrophonePcmEncoder {
  private readonly accumulator = new PcmChunkAccumulator();

  constructor(private readonly transmittedSampleRate = LIVE_INPUT_SAMPLE_RATE) {}

  encode(frame: Float32Array, inputSampleRate: number): LiveMicrophoneChunk[] {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) throw new Error("microphone_sample_rate_invalid");
    const resampled = resampleFloat32(frame, inputSampleRate, this.transmittedSampleRate);
    const pcm = float32ToPcm16(resampled);
    return this.accumulator.push(pcm).map((chunk) => ({
      data: bytesToBase64(chunk),
      byteLength: chunk.byteLength,
      sampleRate: this.transmittedSampleRate
    }));
  }

  clear() {
    this.accumulator.clear();
  }

  get pendingByteCount() {
    return this.accumulator.size;
  }

  get pendingChunkCount() {
    return this.accumulator.size ? 1 : 0;
  }
}

export type LiveMicrophoneCaptureFrame = {
  frame: Float32Array;
  inputSampleRate: number;
  channelCount: number;
};

type AudioContextConstructor = typeof AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

function stopTracks(stream?: MediaStream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export class LiveMicrophoneCapture {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private started = false;

  constructor(
    private readonly onFrame: (frame: LiveMicrophoneCaptureFrame) => void,
    private readonly audioContextFactory = resolveAudioContextConstructor()
  ) {}

  async start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !this.audioContextFactory) {
      throw new Error("microphone_api_unavailable");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(LIVE_MICROPHONE_CONSTRAINTS);
    } catch (error) {
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) throw new Error("microphone_permission_denied");
      throw new Error("microphone_stream_failed");
    }

    try {
      const context = new this.audioContextFactory();
      await context.audioWorklet.addModule("/audio/sema-live-capture-worklet.js");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "sema-live-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const frame = event.data;
        if (frame instanceof Float32Array) this.onFrame({ frame, inputSampleRate: context.sampleRate, channelCount: 1 });
      };
      source.connect(node);
      this.context = context;
      this.stream = stream;
      this.source = source;
      this.node = node;
      this.started = true;
      return { inputSampleRate: context.sampleRate, channelCount: 1 };
    } catch {
      stopTracks(stream);
      throw new Error("microphone_processor_failed");
    }
  }

  stop() {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    stopTracks(this.stream);
    void this.context?.close();
    this.node = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
    this.started = false;
  }

  get active() {
    return this.started;
  }
}
