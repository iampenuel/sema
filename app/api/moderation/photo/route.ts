import { NextResponse } from "next/server";
import {
  AZURE_PHOTO_MODERATION_PROVIDER,
  getAzurePhotoModerationConfig,
  moderationMessage
} from "@/lib/photo/azureModeration";
import { requestAzurePhotoModeration } from "@/lib/photo/azureRequest";
import { PHOTO_PRIVACY_CONFIG } from "@/lib/photo/config";
import { hasSupportedImageSignature, supportedModerationMimeType, validateModerationImageDimensions } from "@/lib/photo/imageValidation";
import type { PhotoModerationFailureCode, PhotoModerationOutcome } from "@/lib/photo/types";

export const dynamic = "force-dynamic";

type DiagnosticOutcome = PhotoModerationOutcome | "rejected";

function responseHeaders() {
  return { "Cache-Control": "no-store" };
}

function requestId() {
  return `photo-mod-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function safeError(code: PhotoModerationFailureCode, message: string, status: number, id = requestId()) {
  return NextResponse.json({ error: { code, message }, requestId: id }, { status, headers: responseHeaders() });
}

function logPhotoModerationDiagnostic(record: { requestId: string; outcome: DiagnosticOutcome; latencyMs: number; inputBytes?: number; mimeType?: string }) {
  console.info(JSON.stringify({
    requestId: record.requestId,
    route: "photo-moderation",
    provider: AZURE_PHOTO_MODERATION_PROVIDER,
    outcome: record.outcome,
    latencyMs: record.latencyMs,
    inputBytes: record.inputBytes,
    mimeType: record.mimeType
  }));
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const id = requestId();
  const config = getAzurePhotoModerationConfig();
  if (!config.enabled || !config.endpoint || !config.key) {
    logPhotoModerationDiagnostic({ requestId: id, outcome: "unavailable", latencyMs: Date.now() - startedAt });
    return safeError("disabled", moderationMessage("unavailable"), 503, id);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return safeError("validation_failed", "Use multipart form data for one captured photo.", 400, id);

  const consent = form.get("moderationConsent");
  const runtimePhotoId = String(form.get("runtimePhotoId") ?? "").trim();
  const image = form.get("image");
  const imageEntries = form.getAll("image");
  if (consent !== "true") return safeError("consent_required", "Photo moderation consent is required.", 403, id);
  if (!runtimePhotoId || runtimePhotoId.length > 120) return safeError("validation_failed", "A runtime photo ID is required.", 400, id);
  if (imageEntries.length !== 1 || !(image instanceof File)) return safeError("validation_failed", "Exactly one image is required.", 400, id);
  if (!supportedModerationMimeType(image.type)) return safeError("unsupported_mime", "Only sanitized JPEG images are supported.", 415, id);
  if (image.size <= 0) return safeError("invalid_image", "The image is empty or corrupt.", 400, id);
  if (image.size > PHOTO_PRIVACY_CONFIG.maximumBytes) return safeError("too_large", "The image must be at most 4 MB.", 413, id);

  const bytes = new Uint8Array(await image.arrayBuffer());
  try {
    if (!hasSupportedImageSignature(bytes, image.type)) return safeError("invalid_image", "The image signature does not match the declared type.", 400, id);
    const dimensions = validateModerationImageDimensions(bytes, image.type, PHOTO_PRIVACY_CONFIG.azureMinimumDimension, PHOTO_PRIVACY_CONFIG.azureMaximumDimension);
    if (!dimensions.ok) return safeError(dimensions.code, dimensions.code === "too_small" ? "The image must be at least 50 × 50 pixels." : dimensions.code === "too_wide" ? "The image must be no larger than 2048 × 2048 pixels." : "The image dimensions could not be validated.", 400, id);

    const result = await requestAzurePhotoModeration({
      endpoint: config.endpoint,
      key: config.key,
      rawBase64: Buffer.from(bytes).toString("base64"),
      config,
      signal: request.signal
    });

    if (!result.ok) {
      const code: PhotoModerationFailureCode =
        result.code === "timeout" ? "timeout" :
        result.code === "network_error" ? "network_error" :
        result.code === "malformed_response" ? "malformed_response" :
        result.providerError?.status === 429 ? "rate_limited" :
        "provider_unavailable";
      logPhotoModerationDiagnostic({ requestId: id, outcome: "unavailable", latencyMs: Date.now() - startedAt, inputBytes: image.size, mimeType: image.type });
      return safeError(code, moderationMessage("unavailable"), code === "timeout" ? 504 : 503, id);
    }

    logPhotoModerationDiagnostic({ requestId: id, outcome: result.outcome, latencyMs: Date.now() - startedAt, inputBytes: image.size, mimeType: image.type });
    return NextResponse.json({
      outcome: result.outcome,
      provider: AZURE_PHOTO_MODERATION_PROVIDER,
      requestId: id,
      message: moderationMessage(result.outcome)
    }, { headers: responseHeaders() });
  } finally {
    bytes.fill(0);
  }
}

export function GET() {
  return safeError("validation_failed", "Use POST for photo moderation.", 405);
}
