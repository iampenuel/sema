import type { AzurePhotoModerationConfig } from "./azureModeration";
import { AZURE_PHOTO_MODERATION_API_VERSION, classifyAzureSexualSeverity, normalizeAzureEndpointRoot, parseAzureSexualSeverity } from "./azureModeration";
import type { PhotoModerationOutcome } from "./types";

export type AzureProviderError = {
  status: number;
  xMsErrorCode?: string;
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
  nonJsonBody?: boolean;
};

export type AzureRequestImageMetadata = {
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  byteLength: number;
  base64Length: number;
};

export type AzureModerationSuccess = {
  ok: true;
  outcome: PhotoModerationOutcome;
  severity: 0 | 2 | 4 | 6;
  requestId?: string;
};

export type AzureModerationFailure = {
  ok: false;
  code: "endpoint_invalid" | "base64_invalid" | "provider_error" | "malformed_response" | "timeout" | "network_error";
  providerError?: AzureProviderError;
};

export type AzureModerationProviderResult = AzureModerationSuccess | AzureModerationFailure;

export function buildAzureAnalyzeUrl(endpoint: string) {
  const root = normalizeAzureEndpointRoot(endpoint);
  if (!root) return undefined;
  return `${root}/contentsafety/image:analyze?api-version=${AZURE_PHOTO_MODERATION_API_VERSION}`;
}

export function normalizeRawBase64(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^data:/i.test(trimmed)) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) return undefined;
  return trimmed;
}

export function buildAzureAnalyzeBody(rawBase64: string) {
  const content = normalizeRawBase64(rawBase64);
  if (!content) return undefined;
  return {
    image: { content },
    categories: ["Sexual"] as const,
    outputType: "FourSeverityLevels" as const
  };
}

function sanitizeProviderMessage(value: string) {
  return value
    .replace(/https:\/\/[^\s"',)]+/gi, "[redacted-url]")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[redacted-image-data-url]")
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[redacted-base64]")
    .slice(0, 500);
}

export async function parseAzureProviderError(response: Response): Promise<AzureProviderError> {
  const error: AzureProviderError = {
    status: response.status,
    xMsErrorCode: response.headers.get("x-ms-error-code") ?? undefined,
    requestId: response.headers.get("x-ms-request-id") ?? response.headers.get("apim-request-id") ?? undefined
  };
  const text = await response.text().catch(() => "");
  if (!text) return error;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    if (typeof parsed.error?.code === "string") error.errorCode = parsed.error.code;
    if (typeof parsed.error?.message === "string") error.errorMessage = sanitizeProviderMessage(parsed.error.message);
  } catch {
    error.nonJsonBody = true;
  }
  return error;
}

export function providerErrorSummary(error: AzureProviderError, image?: Pick<AzureRequestImageMetadata, "width" | "height" | "byteLength">) {
  return {
    status: error.status,
    xMsErrorCode: error.xMsErrorCode,
    errorCode: error.errorCode,
    errorMessage: error.errorMessage,
    requestId: error.requestId,
    nonJsonBody: error.nonJsonBody === true ? true : undefined,
    imageWidth: image?.width,
    imageHeight: image?.height,
    imageByteCount: image?.byteLength
  };
}

export async function requestAzurePhotoModeration(input: {
  endpoint: string;
  key: string;
  rawBase64: string;
  config: Pick<AzurePhotoModerationConfig, "allowMax" | "uncertainMax" | "timeoutMs">;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<AzureModerationProviderResult> {
  const url = buildAzureAnalyzeUrl(input.endpoint);
  const body = buildAzureAnalyzeBody(input.rawBase64);
  if (!url) return { ok: false, code: "endpoint_invalid" };
  if (!body) return { ok: false, code: "base64_invalid" };

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": input.key
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, code: "provider_error", providerError: await parseAzureProviderError(response) };
    const parsed = parseAzureSexualSeverity(await response.json().catch(() => null));
    if (!parsed.ok) return { ok: false, code: "malformed_response" };
    return {
      ok: true,
      severity: parsed.severity,
      outcome: classifyAzureSexualSeverity(parsed.severity, input.config),
      requestId: response.headers.get("x-ms-request-id") ?? response.headers.get("apim-request-id") ?? undefined
    };
  } catch {
    return { ok: false, code: controller.signal.aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}
