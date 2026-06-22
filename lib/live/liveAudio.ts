export const LIVE_INPUT_SAMPLE_RATE = 16_000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000;
export const LIVE_INPUT_CHUNK_BYTES = LIVE_INPUT_SAMPLE_RATE * 2 * 0.02;

export function canCompleteLivePlayback(generationComplete: boolean, pendingSchedules: number, activeSources: number) {
  return generationComplete && pendingSchedules === 0 && activeSources === 0;
}

export class PcmChunkAccumulator {
  private pending = new Uint8Array(0);

  constructor(private readonly chunkBytes = LIVE_INPUT_CHUNK_BYTES) {}

  push(bytes: Uint8Array) {
    const combined = new Uint8Array(this.pending.byteLength + bytes.byteLength);
    combined.set(this.pending);
    combined.set(bytes, this.pending.byteLength);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (combined.byteLength - offset >= this.chunkBytes) {
      chunks.push(combined.slice(offset, offset + this.chunkBytes));
      offset += this.chunkBytes;
    }
    this.pending = combined.slice(offset);
    return chunks;
  }

  flush() {
    const remainder = this.pending;
    this.pending = new Uint8Array(0);
    return remainder;
  }

  clear() { this.pending = new Uint8Array(0); }
  get size() { return this.pending.byteLength; }
}

export function resampleFloat32(input: Float32Array, sourceRate: number, targetRate = LIVE_INPUT_SAMPLE_RATE) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    output[i] = input[left] * (1 - mix) + input[right] * mix;
  }
  return output;
}

export function float32ToPcm16(input: Float32Array) {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  input.forEach((sample, index) => view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff)), true));
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  return btoa(binary);
}

export function base64ToPcm16(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 0x8000;
  return samples;
}

export class OrderedPcmQueue<T> {
  private items: Array<{ generation: number; value: T }> = [];
  enqueue(generation: number, value: T) { this.items.push({ generation, value }); }
  shift(activeGeneration: number) {
    while (this.items.length && this.items[0].generation !== activeGeneration) this.items.shift();
    return this.items.shift()?.value;
  }
  clear() { this.items = []; }
  get size() { return this.items.length; }
}
