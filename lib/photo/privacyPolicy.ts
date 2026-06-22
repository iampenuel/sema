import { PHOTO_PRIVACY_CONFIG } from "./config";
import type { PhotoPrivacyResult } from "./types";

type Prediction = { className: string; probability: number };

const intimateLabels = new Set(["Porn", "Sexy", "Hentai"]);
const expectedLabels = new Set(["Drawing", "Hentai", "Neutral", "Porn", "Sexy"]);

export function resultFromPredictions(predictions: Prediction[], now = Date.now(), latencyMs?: number): PhotoPrivacyResult {
  if (predictions.length !== expectedLabels.size) return invalidResult(now, latencyMs);
  const byLabel = new Map(predictions.map((prediction) => [prediction.className, prediction.probability]));
  if ([...expectedLabels].some((label) => !byLabel.has(label))) return invalidResult(now, latencyMs);
  if (predictions.some((prediction) => !Number.isFinite(prediction.probability) || prediction.probability < 0 || prediction.probability > 1)) return invalidResult(now, latencyMs);

  const intimateScore = predictions.reduce((sum, prediction) => sum + (intimateLabels.has(prediction.className) ? prediction.probability : 0), 0);
  if (intimateScore >= PHOTO_PRIVACY_CONFIG.blockedThreshold) {
    return { decision: "blocked", confidence: intimateScore, reasonCode: "potentially_intimate", modelVersion: PHOTO_PRIVACY_CONFIG.modelVersion, latencyMs, evaluatedAt: now };
  }
  if (intimateScore > PHOTO_PRIVACY_CONFIG.uncertainThreshold) {
    return { decision: "uncertain", confidence: intimateScore, reasonCode: "low_confidence", modelVersion: PHOTO_PRIVACY_CONFIG.modelVersion, latencyMs, evaluatedAt: now };
  }
  return { decision: "allowed", confidence: 1 - intimateScore, reasonCode: "clear", modelVersion: PHOTO_PRIVACY_CONFIG.modelVersion, latencyMs, evaluatedAt: now };
}

function invalidResult(now: number, latencyMs?: number): PhotoPrivacyResult {
  return { decision: "uncertain", reasonCode: "frame_invalid", modelVersion: PHOTO_PRIVACY_CONFIG.modelVersion, latencyMs, evaluatedAt: now };
}

export function unavailableResult(reasonCode: "model_unavailable" | "model_loading" | "model_error" | "frame_invalid", now = Date.now()): PhotoPrivacyResult {
  return { decision: "uncertain", reasonCode, modelVersion: PHOTO_PRIVACY_CONFIG.modelVersion, evaluatedAt: now };
}

export function staleResult(result: PhotoPrivacyResult, now = Date.now()) {
  return now - result.evaluatedAt > PHOTO_PRIVACY_CONFIG.resultFreshnessMs
    ? { ...result, decision: "uncertain" as const, reasonCode: "result_stale" as const, evaluatedAt: now }
    : result;
}

export type PreviewGateState = { allowedStreak: number; latest?: PhotoPrivacyResult };

export function advancePreviewGate(state: PreviewGateState, result: PhotoPrivacyResult): PreviewGateState {
  return {
    latest: result,
    allowedStreak: result.decision === "allowed" && result.reasonCode === "clear" ? state.allowedStreak + 1 : 0
  };
}

export function canCapturePhoto(state: PreviewGateState, now: number, conditions: {
  modelReady: boolean;
  permissionGranted: boolean;
  streamActive: boolean;
  inferenceRunning: boolean;
  pageVisible: boolean;
  captureProcessing: boolean;
}) {
  const result = state.latest;
  return Boolean(
    result &&
    result.decision === "allowed" &&
    result.reasonCode === "clear" &&
    now - result.evaluatedAt <= PHOTO_PRIVACY_CONFIG.resultFreshnessMs &&
    state.allowedStreak >= PHOTO_PRIVACY_CONFIG.requiredAllowedStreak &&
    conditions.modelReady && conditions.permissionGranted && conditions.streamActive &&
    !conditions.inferenceRunning && conditions.pageVisible && !conditions.captureProcessing
  );
}
