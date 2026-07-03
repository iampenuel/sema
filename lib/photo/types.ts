export type CameraFacingMode =
  | "user"
  | "environment"
  | "left"
  | "right"
  | "unknown";

export type RequestedCameraFacingMode = "user" | "environment" | "unspecified";

export type CameraFacingEvidence = {
  requestedFacingMode: RequestedCameraFacingMode;
  reportedFacingMode: CameraFacingMode;
};

export type PhotoCaptureStatus =
  | "idle"
  | "azure_disclosure_required"
  | "requesting_permission"
  | "camera_unavailable"
  | "permission_denied"
  | "previewing"
  | "capturing"
  | "checking_capture"
  | "reviewing"
  | "saving"
  | "saved"
  | "discarded"
  | "moderation_uncertain"
  | "moderation_blocked"
  | "moderation_unavailable"
  | "error";

export type AzurePhotoModerationProvider = "azure_content_safety";

export type PhotoModerationOutcome =
  | "allowed"
  | "uncertain"
  | "blocked"
  | "unavailable";

export type PhotoModerationFailureCode =
  | "consent_required"
  | "disabled"
  | "validation_failed"
  | "unsupported_mime"
  | "invalid_image"
  | "too_large"
  | "too_small"
  | "too_wide"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "malformed_response"
  | "network_error"
  | "unknown_error";

export type PhotoModerationStatus = {
  available: boolean;
  provider: AzurePhotoModerationProvider;
};

export type PhotoModerationResponse = {
  outcome: PhotoModerationOutcome;
  provider: AzurePhotoModerationProvider;
  requestId: string;
  message: string;
  code?: PhotoModerationFailureCode;
};

export type PhotoObservationMetadata = {
  id: string;
  createdAt: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
  sizeBytes: number;
  note: string;
  bodyLocation?: string;
  tags: string[];
  includeInPacket: boolean;
  source: "patient_camera_capture";
  privacyGuardStatus: "passed_automated_content_screening";
  availability: "current_tab_only";
};

export type EphemeralPhotoDraft = PhotoObservationMetadata & {
  blob: Blob;
  objectUrl: string;
  moderationProvider: AzurePhotoModerationProvider;
  status: "needs_review" | "approved" | "discarded";
};

export type RuntimePhotoAttachment = {
  metadata: PhotoObservationMetadata;
  blob?: Blob;
};
