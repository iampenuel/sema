import { LIVE_OUTPUT_SAMPLE_RATE } from "./liveAudio";

type AudioContextConstructor = typeof AudioContext;

export type LivePcmOutputPlayerStats = {
  actualSampleRate?: number;
  audioContextState?: "running" | "suspended" | "closed" | "unknown";
  audioContextCurrentTime?: number;
  nextStartTime: number;
  earliestScheduledStartTime?: number;
  latestScheduledEndTime?: number;
  expectedRemainingPlaybackMs: number;
  decodedAudioChunkCount: number;
  decodedSampleCount: number;
  scheduledSourceCount: number;
  startedSourceCount: number;
  sourceStartCallCount: number;
  endedSourceCount: number;
  activeOutputSourceCount: number;
  lastSourceScheduledAt?: number;
  lastSourceEndedAt?: number;
  sourceEndProgressCount: number;
  drainWatchdogRearmCount?: number;
  playerState: "idle" | "playing" | "draining" | "stalled" | "stopped" | "closed";
  suspendedAt?: number;
  resumedAt?: number;
};

export class LivePcmOutputError extends Error {
  constructor(readonly boundary: "pcm_base64_decode_failed" | "pcm_has_no_complete_samples" | "pcm_decode_failed" | "decoded_audio_not_buffered" | "audio_buffer_creation_failed" | "buffered_audio_not_scheduled" | "scheduled_source_not_started" | "source_creation_failed" | "source_schedule_failed" | "source_started_but_not_ended" | "source_end_stalled_after_expected_end" | "audio_context_closed_unexpectedly" | "audio_context_resume_failed" | "audio_context_clock_not_advancing" | "player_drain_invariant_failed" | "player_failed_to_drain", message: string) {
    super(message);
  }
}

export const LIVE_PLAYER_DRAIN_GRACE_MS = 2_500;

type DrainWatchdogBoundary =
  | "source_end_stalled_after_expected_end"
  | "audio_context_closed_unexpectedly"
  | "audio_context_clock_not_advancing";

export type LivePcmDrainWatchdogDecision =
  | { status: "drained" }
  | { status: "healthy"; progressObserved: boolean }
  | { status: "failed"; boundary: DrainWatchdogBoundary };

export function evaluateLivePcmDrainWatchdog(input: {
  stats: LivePcmOutputPlayerStats;
  lastAudioContextCurrentTime?: number;
  lastEndedSourceCount: number;
  graceMs?: number;
}): LivePcmDrainWatchdogDecision {
  if (input.stats.activeOutputSourceCount === 0) return { status: "drained" };
  if (input.stats.audioContextState === "closed") return { status: "failed", boundary: "audio_context_closed_unexpectedly" };
  if (input.stats.audioContextState === "suspended") return { status: "healthy", progressObserved: false };

  const currentTime = input.stats.audioContextCurrentTime ?? 0;
  const lastCurrentTime = input.lastAudioContextCurrentTime ?? currentTime;
  const endedProgress = input.stats.endedSourceCount > input.lastEndedSourceCount;
  const clockProgress = currentTime > lastCurrentTime + 0.005;
  const latestEnd = input.stats.latestScheduledEndTime;
  const graceSeconds = (input.graceMs ?? LIVE_PLAYER_DRAIN_GRACE_MS) / 1_000;

  if (typeof latestEnd === "number" && currentTime > latestEnd + graceSeconds && !endedProgress) {
    return { status: "failed", boundary: "source_end_stalled_after_expected_end" };
  }
  if (!clockProgress && !endedProgress && input.stats.audioContextState === "running") {
    return { status: "failed", boundary: "audio_context_clock_not_advancing" };
  }
  return { status: "healthy", progressObserved: clockProgress || endedProgress };
}

export function decodeBase64Pcm16LittleEndian(data: string) {
  let binary = "";
  try {
    binary = atob(data.replace(/\s+/g, ""));
  } catch {
    throw new LivePcmOutputError("pcm_base64_decode_failed", "PCM audio could not be decoded.");
  }
  const completeBytes = binary.length - (binary.length % 2);
  if (completeBytes < 2) throw new LivePcmOutputError("pcm_has_no_complete_samples", "PCM audio did not contain complete samples.");
  try {
    const samples = new Float32Array(completeBytes / 2);
    for (let index = 0; index < completeBytes; index += 2) {
      const low = binary.charCodeAt(index);
      const high = binary.charCodeAt(index + 1);
      let value = (high << 8) | low;
      if (value >= 0x8000) value -= 0x10000;
      samples[index / 2] = value / 32768;
    }
    return samples;
  } catch {
    throw new LivePcmOutputError("pcm_decode_failed", "PCM samples could not be converted.");
  }
}

function resolveAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

export class LivePcmOutputPlayer {
  private context?: AudioContext;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private drainWaiters = new Set<{
    resolve: (stats: LivePcmOutputPlayerStats) => void;
    reject: (error: LivePcmOutputError) => void;
    timer?: ReturnType<typeof setTimeout>;
    lastAudioContextCurrentTime?: number;
    lastEndedSourceCount: number;
    graceMs: number;
    rearmCount: number;
    resumeAttempted: boolean;
  }>();
  private stats: LivePcmOutputPlayerStats = {
    nextStartTime: 0,
    expectedRemainingPlaybackMs: 0,
    decodedAudioChunkCount: 0,
    decodedSampleCount: 0,
    scheduledSourceCount: 0,
    startedSourceCount: 0,
    sourceStartCallCount: 0,
    endedSourceCount: 0,
    activeOutputSourceCount: 0,
    sourceEndProgressCount: 0,
    playerState: "idle"
  };

  constructor(private readonly audioContextFactory = resolveAudioContextConstructor()) {}

  async init() {
    if (!this.audioContextFactory) throw new LivePcmOutputError("decoded_audio_not_buffered", "Audio output is unavailable in this browser.");
    this.context = new this.audioContextFactory({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE });
    this.stats.actualSampleRate = this.context.sampleRate;
    this.stats.audioContextState = this.normalizeContextState();
    if (this.context.state === "suspended") await this.context.resume();
    this.stats.audioContextState = this.normalizeContextState();
    if (this.context.state === "running") this.stats.resumedAt = Date.now();
    if (this.context.state !== "running") throw new LivePcmOutputError("scheduled_source_not_started", "Audio output did not start.");
    this.nextStartTime = this.context.currentTime;
    return this.getStats();
  }

  enqueueBase64Pcm(data: string) {
    const context = this.context;
    if (!context || context.state === "closed") throw new LivePcmOutputError("decoded_audio_not_buffered", "Audio output is not initialized.");
    const samples = decodeBase64Pcm16LittleEndian(data);
    if (!samples.length) throw new LivePcmOutputError("pcm_has_no_complete_samples", "PCM audio did not contain samples.");
    let buffer: AudioBuffer;
    try {
      buffer = context.createBuffer(1, samples.length, LIVE_OUTPUT_SAMPLE_RATE);
    } catch {
      throw new LivePcmOutputError("audio_buffer_creation_failed", "Decoded audio could not be buffered.");
    }
    try {
      buffer.getChannelData(0).set(samples);
    } catch {
      throw new LivePcmOutputError("decoded_audio_not_buffered", "Decoded audio could not be buffered.");
    }
    let source: AudioBufferSourceNode;
    try {
      source = context.createBufferSource();
    } catch {
      throw new LivePcmOutputError("source_creation_failed", "Audio source could not be created.");
    }
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(this.nextStartTime, context.currentTime + 0.01);
    const endAt = startAt + buffer.duration;
    this.nextStartTime = endAt;
    this.activeSources.add(source);
    this.stats.activeOutputSourceCount = this.activeSources.size;
    this.stats.decodedAudioChunkCount += 1;
    this.stats.decodedSampleCount += samples.length;
    this.stats.scheduledSourceCount += 1;
    this.stats.earliestScheduledStartTime = Math.min(this.stats.earliestScheduledStartTime ?? startAt, startAt);
    this.stats.latestScheduledEndTime = Math.max(this.stats.latestScheduledEndTime ?? endAt, endAt);
    this.stats.lastSourceScheduledAt = Date.now();
    this.stats.playerState = "playing";
    source.onended = () => {
      this.activeSources.delete(source);
      this.stats.activeOutputSourceCount = this.activeSources.size;
      this.stats.endedSourceCount += 1;
      this.stats.sourceEndProgressCount += 1;
      this.stats.lastSourceEndedAt = Date.now();
      this.resolveDrainIfIdle();
      this.rearmDrainWaiters();
    };
    try {
      source.start(startAt);
      this.stats.startedSourceCount += 1;
      this.stats.sourceStartCallCount += 1;
    } catch {
      this.activeSources.delete(source);
      this.stats.activeOutputSourceCount = this.activeSources.size;
      this.resolveDrainIfIdle();
      throw new LivePcmOutputError("source_schedule_failed", "Buffered audio could not be scheduled.");
    }
    this.stats.audioContextState = this.normalizeContextState();
    this.rearmDrainWaiters();
    return this.getStats();
  }

  waitForDrain(options: { graceMs?: number } = {}) {
    if (!this.activeSources.size) return Promise.resolve(this.getStats());
    const stats = this.getStats();
    return new Promise<LivePcmOutputPlayerStats>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: undefined,
        lastAudioContextCurrentTime: stats.audioContextCurrentTime,
        lastEndedSourceCount: stats.endedSourceCount,
        graceMs: options.graceMs ?? LIVE_PLAYER_DRAIN_GRACE_MS,
        rearmCount: 0,
        resumeAttempted: false
      };
      this.stats.playerState = "draining";
      this.drainWaiters.add(waiter);
      this.armDrainWaiter(waiter);
    });
  }

  stop() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.activeSources.clear();
    this.stats.activeOutputSourceCount = 0;
    this.nextStartTime = 0;
    this.stats.nextStartTime = 0;
    this.stats.expectedRemainingPlaybackMs = 0;
    this.stats.playerState = "stopped";
    this.resolveDrainIfIdle();
  }

  close() {
    this.stop();
    void this.context?.close();
    this.context = undefined;
    this.stats.playerState = "closed";
  }

  getStats(): LivePcmOutputPlayerStats {
    this.stats.audioContextState = this.normalizeContextState();
    const currentTime = this.context?.currentTime;
    this.stats.audioContextCurrentTime = currentTime;
    this.stats.nextStartTime = this.nextStartTime;
    this.stats.expectedRemainingPlaybackMs = Math.max(0, ((this.stats.latestScheduledEndTime ?? currentTime ?? 0) - (currentTime ?? 0)) * 1_000);
    this.stats.activeOutputSourceCount = this.activeSources.size;
    if (this.stats.audioContextState === "suspended" && !this.stats.suspendedAt) this.stats.suspendedAt = Date.now();
    if (this.stats.audioContextState === "running" && this.stats.suspendedAt) this.stats.resumedAt = Date.now();
    return { ...this.stats };
  }

  private normalizeContextState() {
    const state = this.context?.state;
    return state === "running" || state === "suspended" || state === "closed" ? state : "unknown";
  }

  private resolveDrainIfIdle() {
    if (this.activeSources.size) return;
    if (this.stats.playerState !== "closed" && this.stats.playerState !== "stopped") this.stats.playerState = "idle";
    const waiters = Array.from(this.drainWaiters);
    this.drainWaiters.clear();
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(this.getStats());
    }
  }

  private rearmDrainWaiters() {
    for (const waiter of this.drainWaiters) this.armDrainWaiter(waiter);
  }

  private armDrainWaiter(waiter: {
    resolve: (stats: LivePcmOutputPlayerStats) => void;
    reject: (error: LivePcmOutputError) => void;
    timer?: ReturnType<typeof setTimeout>;
    lastAudioContextCurrentTime?: number;
    lastEndedSourceCount: number;
    graceMs: number;
    rearmCount: number;
    resumeAttempted: boolean;
  }) {
    if (waiter.timer) clearTimeout(waiter.timer);
    const stats = this.getStats();
    if (stats.activeOutputSourceCount === 0) {
      this.drainWaiters.delete(waiter);
      waiter.resolve(stats);
      return;
    }
    if (stats.audioContextState === "suspended" && !waiter.resumeAttempted) {
      waiter.resumeAttempted = true;
      this.context?.resume()
        .then(() => {
          this.stats.resumedAt = Date.now();
          this.armDrainWaiter(waiter);
        })
        .catch(() => {
          this.drainWaiters.delete(waiter);
          waiter.reject(new LivePcmOutputError("audio_context_resume_failed", "Audio output could not resume."));
        });
    }
    const timeoutMs = Math.max(50, stats.expectedRemainingPlaybackMs + waiter.graceMs);
    waiter.rearmCount += 1;
    this.stats.drainWatchdogRearmCount = waiter.rearmCount;
    waiter.timer = setTimeout(() => {
      const nextStats = this.getStats();
      const decision = evaluateLivePcmDrainWatchdog({
        stats: nextStats,
        lastAudioContextCurrentTime: waiter.lastAudioContextCurrentTime,
        lastEndedSourceCount: waiter.lastEndedSourceCount,
        graceMs: waiter.graceMs
      });
      if (decision.status === "drained") {
        this.drainWaiters.delete(waiter);
        waiter.resolve(nextStats);
        return;
      }
      if (decision.status === "failed") {
        this.drainWaiters.delete(waiter);
        this.stats.playerState = "stalled";
        waiter.reject(new LivePcmOutputError(decision.boundary, "Audio playback stopped making progress."));
        return;
      }
      waiter.lastAudioContextCurrentTime = nextStats.audioContextCurrentTime;
      waiter.lastEndedSourceCount = nextStats.endedSourceCount;
      this.armDrainWaiter(waiter);
    }, timeoutMs);
  }
}
