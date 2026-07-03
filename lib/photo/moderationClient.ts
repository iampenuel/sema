import type { PhotoModerationResponse, PhotoModerationStatus } from "./types";

async function readModerationJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body as { error?: { code?: string; message?: string } } : undefined;
    return {
      outcome: "unavailable",
      provider: "azure_content_safety",
      requestId: "",
      code: error?.error?.code ?? "provider_unavailable",
      message: error?.error?.message ?? "Photo screening is unavailable, so this image cannot be added right now. You can continue using text or the body map."
    } as T;
  }
  return body as T;
}

export async function fetchPhotoModerationStatus(signal?: AbortSignal) {
  return readModerationJson<PhotoModerationStatus>(await fetch("/api/moderation/photo/status", { signal, cache: "no-store" }));
}

export async function moderatePhotoWithAzure(input: { blob: Blob; runtimePhotoId: string; consent: true }, signal?: AbortSignal) {
  const form = new FormData();
  form.set("runtimePhotoId", input.runtimePhotoId);
  form.set("moderationConsent", input.consent ? "true" : "false");
  form.set("image", input.blob, "sema-captured-photo.jpg");
  return readModerationJson<PhotoModerationResponse>(await fetch("/api/moderation/photo", {
    method: "POST",
    body: form,
    signal,
    cache: "no-store"
  }));
}
