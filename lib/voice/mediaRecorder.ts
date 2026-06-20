import type { VoiceCaptureErrorCode } from "./voiceTypes";

export const MAX_DEMO_RECORDING_SECONDS = 180;

export function classifyMicrophoneError(error: unknown): { code: VoiceCaptureErrorCode; message: string } {
  const name = error instanceof DOMException ? error.name : typeof error === "object" && error && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { code: "permission_denied", message: "Microphone access was not granted. You can enable it in your browser settings or continue with typed notes." };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return { code: "device_not_found", message: "No microphone was found. You can continue with typed notes." };
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return { code: "device_busy", message: "The microphone is unavailable or being used by another app. Typed notes remain available." };
  }
  return { code: "recording_failed", message: "Sema could not start browser recording. Typed notes remain available." };
}

export function stopMediaTracks(stream?: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function revokeObjectUrl(url?: string, urlApi: Pick<typeof URL, "revokeObjectURL"> = URL) {
  if (url?.startsWith("blob:")) urlApi.revokeObjectURL(url);
}

export function isUsableRecording(chunks: Blob[]) {
  return chunks.some((chunk) => chunk.size > 0);
}

export function buildRecordingBlob(chunks: Blob[], mimeType: string) {
  if (!isUsableRecording(chunks)) return null;
  return new Blob(chunks, { type: mimeType || "audio/webm" });
}

export async function requestBrowserMicrophone(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  try {
    const stream = await getUserMedia({ audio: true });
    stopMediaTracks(stream);
    return { granted: true as const };
  } catch (error) {
    return { granted: false as const, ...classifyMicrophoneError(error) };
  }
}
