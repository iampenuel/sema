export type PhotoPrivacyProviderId = "local_model" | "mock" | "unavailable";

export type PhotoPrivacyDecision = "allowed" | "blocked" | "uncertain";

export type PhotoPrivacyReasonCode =
  | "clear"
  | "potentially_intimate"
  | "low_confidence"
  | "model_unavailable"
  | "model_loading"
  | "model_error"
  | "frame_invalid"
  | "result_stale";

export type PhotoPrivacyResult = {
  decision: PhotoPrivacyDecision;
  confidence?: number;
  reasonCode: PhotoPrivacyReasonCode;
  modelVersion?: string;
  latencyMs?: number;
  evaluatedAt: number;
};

export type PhotoCaptureStatus =
  | "idle"
  | "consent_required"
  | "requesting_permission"
  | "permission_denied"
  | "camera_unavailable"
  | "loading_privacy_guard"
  | "previewing"
  | "checking_preview"
  | "preview_allowed"
  | "preview_blocked"
  | "preview_uncertain"
  | "capturing"
  | "checking_capture"
  | "reviewing"
  | "saving"
  | "saved"
  | "discarded"
  | "error";

export type PhotoObservationMetadata = {
  id: string;
  createdAt: string;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
  note: string;
  bodyLocation?: string;
  tags: string[];
  includeInPacket: boolean;
  source: "patient_camera_capture";
  privacyGuardStatus: "allowed_on_device";
  availability: "current_tab_only";
};

export type EphemeralPhotoDraft = PhotoObservationMetadata & {
  blob: Blob;
  objectUrl: string;
  privacyDecision: "allowed";
  privacyModelVersion?: string;
  status: "needs_review" | "approved" | "discarded";
};

export type PhotoFrameSource = CanvasImageSource | ImageData;

export interface PhotoPrivacyProvider {
  readonly id: PhotoPrivacyProviderId;
  readonly isDevelopmentSimulation?: boolean;
  load(): Promise<void>;
  evaluate(frame: PhotoFrameSource): Promise<PhotoPrivacyResult>;
  dispose(): void | Promise<void>;
}

export type RuntimePhotoAttachment = {
  metadata: PhotoObservationMetadata;
  blob?: Blob;
};
