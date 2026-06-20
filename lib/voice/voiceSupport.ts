export const AUDIO_MIME_PREFERENCES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus"
] as const;

export type VoiceSupport = {
  microphone: boolean;
  mediaRecorder: boolean;
  dictation: boolean;
  pauseResume: boolean;
};

export function detectVoiceSupport(scope: {
  navigator?: Pick<Navigator, "mediaDevices">;
  MediaRecorder?: typeof MediaRecorder;
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}): VoiceSupport {
  const recorder = scope.MediaRecorder;
  return {
    microphone: Boolean(scope.navigator?.mediaDevices?.getUserMedia),
    mediaRecorder: typeof recorder === "function",
    dictation: Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition),
    pauseResume: Boolean(recorder?.prototype?.pause && recorder?.prototype?.resume)
  };
}

export function selectSupportedMimeType(recorder: Pick<typeof MediaRecorder, "isTypeSupported"> | undefined): string | undefined {
  if (!recorder?.isTypeSupported) return undefined;
  return AUDIO_MIME_PREFERENCES.find((type) => recorder.isTypeSupported(type));
}
