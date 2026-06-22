import { PHOTO_PRIVACY_CONFIG } from "./config";

export type SanitizedCapture = { blob: Blob; width: number; height: number; mimeType: "image/jpeg"; sizeBytes: number };

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function sanitizePhotoCapture(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<SanitizedCapture> {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) throw new Error("corrupt_capture");
  const scale = Math.min(1, PHOTO_PRIVACY_CONFIG.maximumLongEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(source, 0, 0, width, height);

  try {
    for (const quality of PHOTO_PRIVACY_CONFIG.jpegQualities) {
      const blob = await canvasToBlob(canvas, quality);
      if (!blob || blob.size === 0) continue;
      if (blob.size <= PHOTO_PRIVACY_CONFIG.maximumBytes) {
        return { blob, width, height, mimeType: "image/jpeg", sizeBytes: blob.size };
      }
    }
    throw new Error("capture_too_large");
  } finally {
    context.clearRect(0, 0, width, height);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function clearCanvas(canvas: HTMLCanvasElement) {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;
}
