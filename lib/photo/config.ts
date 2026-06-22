export const PHOTO_PRIVACY_CONFIG = {
  sampleIntervalMs: 1_000,
  resultFreshnessMs: 1_500,
  requiredAllowedStreak: 4,
  uncertainThreshold: 0.10,
  blockedThreshold: 0.25,
  previewLongEdge: 224,
  maximumLongEdge: 1_600,
  maximumBytes: 5 * 1024 * 1024,
  jpegQualities: [0.88, 0.82, 0.72] as const,
  inferenceTimeoutMs: 8_000,
  modelVersion: "nsfwjs-mobilenet-v2-4.3.0",
  modelAssetBase: "/models/photo-privacy/nsfwjs-mobilenet-v2"
} as const;
