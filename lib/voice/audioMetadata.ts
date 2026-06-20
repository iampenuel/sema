import type { AudioSignal, PacketAudioSignal, SemaSession } from "@/lib/sema-session/types";

type LegacyAudioSignal = Partial<AudioSignal> & {
  objectUrl?: unknown;
  waveformPeaks?: unknown;
  audioBlob?: unknown;
  interimTranscript?: unknown;
};

export function sanitizeAudioSignal(value: LegacyAudioSignal, index = 0): AudioSignal {
  return {
    id: typeof value.id === "string" ? value.id : `audio-migrated-${index}`,
    name: typeof value.name === "string" ? value.name : "Saved audio observation",
    durationSeconds: typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) ? value.durationSeconds : 0,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : undefined,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
    notes: typeof value.notes === "string" ? value.notes : undefined,
    transcript: typeof value.transcript === "string" ? value.transcript : undefined,
    transcriptSource: value.transcriptSource === "browser_transcribed_user_reviewed" ? value.transcriptSource : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    source: value.source === "browser_voice_capture" || value.source === "demo_simulated" || value.source === "manual_note" || value.source === "patient_recorded" ? value.source : "manual_note"
  };
}

export function toPacketAudioSignal(value: AudioSignal): PacketAudioSignal {
  const { id, name, durationSeconds, mimeType, tags, notes, transcript, transcriptSource, createdAt, source } = value;
  return { id, name, durationSeconds, mimeType, tags, notes, transcript, transcriptSource, createdAt, source };
}

export function containsRawAudioFields(value: unknown) {
  const serialized = JSON.stringify(value);
  return /"(?:objectUrl|audioBlob|waveformPeaks|interimTranscript)"|blob:|data:audio\//i.test(serialized);
}

const ephemeralAudioKeys = new Set(["objectUrl", "audioObjectUrl", "audioBlob", "waveformPeaks", "interimTranscript", "stream", "mediaStream"]);

export function serializeSemaSession(session: SemaSession) {
  return JSON.stringify(session, (key, value) => {
    if (ephemeralAudioKeys.has(key)) return undefined;
    if (typeof Blob !== "undefined" && value instanceof Blob) return undefined;
    return value;
  });
}
