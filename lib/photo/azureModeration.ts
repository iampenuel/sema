import { z } from "zod";
import { PHOTO_PRIVACY_CONFIG } from "./config";
import type { PhotoModerationOutcome } from "./types";

export const AZURE_PHOTO_MODERATION_PROVIDER = "azure_content_safety" as const;
export const AZURE_PHOTO_MODERATION_FLAG = "SEMA_ENABLE_AZURE_PHOTO_MODERATION";
export const AZURE_PHOTO_MODERATION_API_VERSION = "2024-09-01";

export const AzureContentSafetyResponseSchema = z.object({
  categoriesAnalysis: z.array(z.object({
    category: z.enum(["Hate", "SelfHarm", "Sexual", "Violence"]),
    severity: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)])
  }))
});

export type AzureContentSafetyResponse = z.infer<typeof AzureContentSafetyResponseSchema>;

export type AzurePhotoModerationConfig = {
  enabled: boolean;
  endpoint?: string;
  key?: string;
  allowMax: 0 | 2 | 4 | 6;
  uncertainMax: 0 | 2 | 4 | 6;
  timeoutMs: number;
};

function parseSeverity(value: string | undefined, fallback: 0 | 2 | 4 | 6): 0 | 2 | 4 | 6 {
  return value === "0" || value === "2" || value === "4" || value === "6" ? Number(value) as 0 | 2 | 4 | 6 : fallback;
}

export function normalizeAzureEndpointRoot(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (url.search || url.hash) return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    const contentSafetyIndex = parts.findIndex((part) => part.toLowerCase() === "contentsafety");
    const rootParts = contentSafetyIndex >= 0 ? parts.slice(0, contentSafetyIndex) : parts;
    url.pathname = rootParts.length ? `/${rootParts.join("/")}` : "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function getAzurePhotoModerationConfig(env: NodeJS.ProcessEnv = process.env): AzurePhotoModerationConfig {
  const endpoint = normalizeAzureEndpointRoot(env.AZURE_CONTENT_SAFETY_ENDPOINT);
  const key = env.AZURE_CONTENT_SAFETY_KEY?.trim();
  const allowMax = parseSeverity(env.SEMA_AZURE_SEXUAL_ALLOW_MAX, 0);
  const uncertainMax = parseSeverity(env.SEMA_AZURE_SEXUAL_UNCERTAIN_MAX, 2);
  const enabled = env[AZURE_PHOTO_MODERATION_FLAG] === "true" && Boolean(endpoint && key && key.length >= 16);
  return { enabled, endpoint, key, allowMax, uncertainMax, timeoutMs: PHOTO_PRIVACY_CONFIG.azureTimeoutMs };
}

export function photoModerationStatus(env: NodeJS.ProcessEnv = process.env) {
  return { available: getAzurePhotoModerationConfig(env).enabled, provider: AZURE_PHOTO_MODERATION_PROVIDER };
}

export function azureAnalyzeUrl(endpoint: string) {
  const root = normalizeAzureEndpointRoot(endpoint);
  return `${root ?? ""}/contentsafety/image:analyze?api-version=${AZURE_PHOTO_MODERATION_API_VERSION}`;
}

export function classifyAzureSexualSeverity(severity: 0 | 2 | 4 | 6, config: Pick<AzurePhotoModerationConfig, "allowMax" | "uncertainMax"> = { allowMax: 0, uncertainMax: 2 }): PhotoModerationOutcome {
  if (severity <= config.allowMax) return "allowed";
  if (severity <= config.uncertainMax) return "uncertain";
  return "blocked";
}

export function parseAzureSexualSeverity(value: unknown) {
  const parsed = AzureContentSafetyResponseSchema.safeParse(value);
  if (!parsed.success) return { ok: false as const, code: "malformed_response" as const };
  const sexual = parsed.data.categoriesAnalysis.filter((item) => item.category === "Sexual");
  if (sexual.length !== 1) return { ok: false as const, code: "malformed_response" as const };
  return { ok: true as const, severity: sexual[0].severity };
}

export function moderationMessage(outcome: PhotoModerationOutcome) {
  if (outcome === "allowed") return "Photo check complete. Review the photo before adding it.";
  if (outcome === "uncertain") return "Sema could not confidently approve this photo. Try taking it again with a clearer view, or continue using text or the body map.";
  if (outcome === "blocked") return "Photo blocked for privacy\n\nAutomated screening flagged this photo as potentially sensitive, so Sema cannot add it. You can retake the photo or continue using text or the body map.";
  return "Photo screening is unavailable, so this image cannot be added right now. You can continue using text or the body map.";
}
