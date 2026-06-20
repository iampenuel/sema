export type VoiceCaptureStatus =
  | "idle"
  | "checking_support"
  | "requesting_permission"
  | "permission_denied"
  | "permission_unavailable"
  | "ready"
  | "recording"
  | "paused"
  | "stopping"
  | "reviewing"
  | "saving"
  | "saved"
  | "cancelled"
  | "error";

export type VoiceCaptureErrorCode =
  | "microphone_unsupported"
  | "permission_denied"
  | "device_not_found"
  | "device_busy"
  | "recording_failed"
  | "transcription_unsupported"
  | "transcription_failed"
  | "recording_too_long"
  | "empty_recording"
  | "unknown_error";

export type VoiceTargetFolder = "story" | "audio";

export type VoiceCaptureState = {
  status: VoiceCaptureStatus;
  permission: "unknown" | "prompt" | "granted" | "denied" | "unsupported";
  recordingId?: string;
  startedAt?: number;
  elapsedSeconds: number;
  mimeType?: string;
  audioBlob?: Blob;
  audioObjectUrl?: string;
  transcriptDraft: string;
  interimTranscript: string;
  transcriptSupported: boolean;
  transcriptActive: boolean;
  targetFolder: VoiceTargetFolder;
  errorCode?: VoiceCaptureErrorCode;
  errorMessage?: string;
  limitReached?: boolean;
};

export type VoiceDraft = {
  id: string;
  createdAt: string;
  targetFolder: VoiceTargetFolder;
  durationSeconds: number;
  mimeType?: string;
  transcriptDraft: string;
  userEditedTranscript: string;
  tags: string[];
  notes: string;
  status: "recording" | "needs_review" | "approved" | "discarded";
  source: "browser_voice_capture";
};
