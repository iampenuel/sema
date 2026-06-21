export type SyntheticPcmOptions = {
  sampleRate?: 16_000;
  durationMs?: number;
  frequencyHz?: number;
  amplitude?: number;
};

export type PcmValidationMetadata = {
  sampleRate: 16_000;
  channels: 1;
  bitDepth: 16;
  durationMs: number;
  byteLength: number;
  base64Length: number;
  clippedSamples: number;
};

export type LiveVadMode = "automatic" | "manual";

export function createDeterministicPcmFixture(options: SyntheticPcmOptions = {}) {
  const sampleRate = options.sampleRate ?? 16_000;
  const durationMs = options.durationMs ?? 750;
  const frequencyHz = options.frequencyHz ?? 440;
  const amplitude = options.amplitude ?? 0.15;
  if (sampleRate !== 16_000) throw new Error("Synthetic PCM must use a 16 kHz sample rate");
  if (durationMs < 500 || durationMs > 1_000) throw new Error("Synthetic PCM duration must be between 500 and 1000 ms");
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) throw new Error("Synthetic PCM frequency must be positive");
  if (!Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 1) throw new Error("Synthetic PCM amplitude must be greater than zero and at most one");
  const sampleCount = Math.round(sampleRate * durationMs / 1_000);
  const buffer = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin(2 * Math.PI * frequencyHz * index / sampleRate);
    buffer.writeInt16LE(Math.round(sample * amplitude * 0x7fff), index * 2);
  }
  return buffer;
}

export function validateSyntheticPcm(
  buffer: Buffer,
  expected: { sampleRate?: number; durationMs?: number } = {}
): PcmValidationMetadata {
  const sampleRate = expected.sampleRate ?? 16_000;
  if (!buffer.length) throw new Error("Synthetic PCM is empty");
  if (sampleRate !== 16_000) throw new Error("Synthetic PCM sample rate is invalid");
  if (buffer.length % 2 !== 0) throw new Error("Synthetic PCM byte length must be even");
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF") throw new Error("Synthetic PCM must not include a WAVE header");
  let clippedSamples = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    if (sample === -0x8000 || sample === 0x7fff) clippedSamples += 1;
  }
  if (clippedSamples) throw new Error("Synthetic PCM contains clipped samples");
  const base64 = buffer.toString("base64");
  if (!base64) throw new Error("Synthetic PCM base64 encoding is empty");
  const durationMs = buffer.length / 2 / 16_000 * 1_000;
  if (expected.durationMs !== undefined && durationMs !== expected.durationMs) throw new Error("Synthetic PCM duration is invalid");
  return {
    sampleRate: 16_000,
    channels: 1,
    bitDepth: 16,
    durationMs,
    byteLength: buffer.length,
    base64Length: base64.length,
    clippedSamples
  };
}

export function validateModelAudio(chunks: string[]) {
  if (!chunks.length || chunks.some((chunk) => !chunk)) throw new Error("Model audio payload is empty");
  const decoded = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64")));
  if (!decoded.length || decoded.length % 2 !== 0) throw new Error("Model audio payload is invalid");
  return { byteLength: decoded.length, bitDepth: 16, expectedSampleRate: 24_000 };
}

export function audioBoundaryMessages(mode: LiveVadMode) {
  return mode === "automatic"
    ? { before: undefined, after: { audioStreamEnd: true } as const }
    : { before: { activityStart: {} } as const, after: { activityEnd: {} } as const };
}
