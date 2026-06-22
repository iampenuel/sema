import type { EphemeralPhotoDraft, PhotoCaptureStatus, PhotoPrivacyResult } from "./types";

export type PhotoCaptureState = {
  status: PhotoCaptureStatus;
  announcement: string;
  latestResult?: PhotoPrivacyResult;
  allowedStreak: number;
  modelReady: boolean;
  permissionGranted: boolean;
  streamActive: boolean;
  inferenceRunning: boolean;
  pageVisible: boolean;
  captureProcessing: boolean;
  draft?: EphemeralPhotoDraft;
};

export type PhotoCaptureEvent =
  | { type: "OPEN" }
  | { type: "REQUEST_PERMISSION" }
  | { type: "PERMISSION_GRANTED" }
  | { type: "PERMISSION_DENIED" }
  | { type: "CAMERA_UNAVAILABLE" }
  | { type: "MODEL_LOADING" }
  | { type: "MODEL_READY" }
  | { type: "MODEL_ERROR" }
  | { type: "INFERENCE_STARTED" }
  | { type: "PREVIEW_RESULT"; result: PhotoPrivacyResult }
  | { type: "CAPTURE_STARTED" }
  | { type: "CAPTURE_REJECTED"; result: PhotoPrivacyResult }
  | { type: "REVIEW_READY"; draft: EphemeralPhotoDraft }
  | { type: "SAVE_STARTED" }
  | { type: "SAVED" }
  | { type: "DISCARDED" }
  | { type: "STREAM_STOPPED" }
  | { type: "VISIBILITY"; visible: boolean }
  | { type: "RESET_PREVIEW" };

export const initialPhotoCaptureState: PhotoCaptureState = {
  status: "idle",
  announcement: "",
  allowedStreak: 0,
  modelReady: false,
  permissionGranted: false,
  streamActive: false,
  inferenceRunning: false,
  pageVisible: true,
  captureProcessing: false
};

function resultStatus(result: PhotoPrivacyResult): PhotoCaptureStatus {
  if (result.reasonCode === "model_error" || result.reasonCode === "model_unavailable" || result.reasonCode === "model_loading") return "error";
  return result.decision === "blocked" ? "preview_blocked" : result.decision === "uncertain" ? "preview_uncertain" : "preview_allowed";
}

export function photoCaptureReducer(state: PhotoCaptureState, event: PhotoCaptureEvent): PhotoCaptureState {
  switch (event.type) {
    case "OPEN": return { ...initialPhotoCaptureState, status: "consent_required", pageVisible: true };
    case "REQUEST_PERMISSION": return { ...state, status: "requesting_permission", announcement: "Requesting camera permission." };
    case "PERMISSION_GRANTED": return { ...state, permissionGranted: true, streamActive: true, status: "loading_privacy_guard", announcement: "Camera permission granted. Loading the on-device privacy check." };
    case "PERMISSION_DENIED": return { ...state, permissionGranted: false, streamActive: false, status: "permission_denied", announcement: "Camera permission was not granted." };
    case "CAMERA_UNAVAILABLE": return { ...state, permissionGranted: false, streamActive: false, status: "camera_unavailable", announcement: "Camera capture is unavailable." };
    case "MODEL_LOADING": return { ...state, modelReady: false, status: "loading_privacy_guard", announcement: "Privacy model loading." };
    case "MODEL_READY": return { ...state, modelReady: true, status: "previewing", announcement: "Privacy check active on this device." };
    case "MODEL_ERROR": return { ...state, modelReady: false, allowedStreak: 0, status: "error", announcement: "Privacy check unavailable. Photo capture is disabled." };
    case "INFERENCE_STARTED": return { ...state, inferenceRunning: true, status: state.allowedStreak ? state.status : "checking_preview" };
    case "PREVIEW_RESULT": {
      const allowedStreak = event.result.decision === "allowed" && event.result.reasonCode === "clear" ? state.allowedStreak + 1 : 0;
      const ready = allowedStreak >= 4 && event.result.decision === "allowed";
      return {
        ...state,
        latestResult: event.result,
        allowedStreak,
        inferenceRunning: false,
        status: ready ? "preview_allowed" : resultStatus(event.result),
        announcement: ready ? "Ready to capture." : event.result.decision === "allowed" ? "Privacy check in progress." : event.result.reasonCode === "model_error" ? "Privacy check unavailable." : "Camera paused for privacy."
      };
    }
    case "CAPTURE_STARTED": return { ...state, captureProcessing: true, inferenceRunning: true, status: "checking_capture", announcement: "Checking the captured frame on this device." };
    case "CAPTURE_REJECTED": return { ...state, captureProcessing: false, inferenceRunning: false, latestResult: event.result, allowedStreak: 0, status: resultStatus(event.result), announcement: event.result.reasonCode === "model_error" ? "Privacy check unavailable." : "Camera paused for privacy." };
    case "REVIEW_READY": return { ...state, captureProcessing: false, inferenceRunning: false, streamActive: false, draft: event.draft, status: "reviewing", announcement: "Photo ready for review." };
    case "SAVE_STARTED": return { ...state, status: "saving", announcement: "Adding the reviewed photo." };
    case "SAVED": return { ...state, status: "saved", draft: undefined, announcement: "Photo added to this Sema session." };
    case "DISCARDED": return { ...initialPhotoCaptureState, status: "discarded", pageVisible: state.pageVisible, announcement: "Photo discarded." };
    case "STREAM_STOPPED": return { ...state, streamActive: false, inferenceRunning: false, allowedStreak: 0 };
    case "VISIBILITY": return { ...state, pageVisible: event.visible, inferenceRunning: false, allowedStreak: event.visible ? state.allowedStreak : 0, latestResult: event.visible ? state.latestResult : undefined, status: event.visible ? state.status : "previewing", announcement: event.visible ? "Privacy check resumed." : "Privacy check paused while this page is hidden." };
    case "RESET_PREVIEW": return { ...state, status: "consent_required", allowedStreak: 0, latestResult: undefined, modelReady: false, streamActive: false, draft: undefined };
  }
}
