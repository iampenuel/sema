import { deflateSync } from "node:zlib";
import { loadEnvConfig } from "@next/env";
import { getAzurePhotoModerationConfig } from "../azureModeration";
import { providerErrorSummary, requestAzurePhotoModeration, type AzureRequestImageMetadata } from "../azureRequest";
import { PHOTO_PRIVACY_CONFIG } from "../config";
import { hasSupportedImageSignature, readImageDimensions, supportedSmokeMimeType, validateModerationImageDimensions } from "../imageValidation";

loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });

const SMOKE_MIME_TYPE = "image/png" as const;
const SMOKE_SIZE = 128;

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length);
  return out;
}

function createSyntheticBenignPng() {
  const width = SMOKE_SIZE;
  const height = SMOKE_SIZE;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 4;
      const inBox = x > 24 && x < 64 && y > 24 && y < 64;
      const inCircle = (x - 88) ** 2 + (y - 80) ** 2 < 22 ** 2;
      const onDiagonal = Math.abs(x - y) < 3;
      pixels[index] = inBox ? 236 : onDiagonal ? 88 : 180;
      pixels[index + 1] = inCircle ? 190 : onDiagonal ? 116 : 218;
      pixels[index + 2] = inBox ? 96 : inCircle ? 116 : 244;
      pixels[index + 3] = 255;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function validateSyntheticImage(bytes: Uint8Array): AzureRequestImageMetadata {
  if (!supportedSmokeMimeType(SMOKE_MIME_TYPE)) throw new Error("Synthetic smoke image uses an unsupported MIME type.");
  if (bytes.byteLength <= 0 || bytes.byteLength > PHOTO_PRIVACY_CONFIG.maximumBytes) throw new Error("Synthetic smoke image has an invalid byte length.");
  if (!hasSupportedImageSignature(bytes, SMOKE_MIME_TYPE)) throw new Error("Synthetic smoke image has an invalid signature.");
  const dimensions = validateModerationImageDimensions(bytes, SMOKE_MIME_TYPE, PHOTO_PRIVACY_CONFIG.azureMinimumDimension, PHOTO_PRIVACY_CONFIG.azureMaximumDimension);
  if (!dimensions.ok) throw new Error(`Synthetic smoke image dimensions failed local validation: ${dimensions.code}.`);
  const readDimensions = readImageDimensions(bytes, SMOKE_MIME_TYPE);
  if (!readDimensions || readDimensions.width !== dimensions.dimensions.width || readDimensions.height !== dimensions.dimensions.height) {
    throw new Error("Synthetic smoke image dimensions could not be read consistently.");
  }
  const base64Length = Buffer.from(bytes).toString("base64").length;
  return {
    mimeType: SMOKE_MIME_TYPE,
    width: dimensions.dimensions.width,
    height: dimensions.dimensions.height,
    byteLength: bytes.byteLength,
    base64Length
  };
}

function sanitizedFailure(code: string, image: AzureRequestImageMetadata, providerError?: Parameters<typeof providerErrorSummary>[0]) {
  return JSON.stringify({
    provider: "azure_content_safety",
    outcome: "failed",
    code,
    error: providerError ? providerErrorSummary(providerError, image) : undefined,
    image
  });
}

async function main() {
  const config = getAzurePhotoModerationConfig();
  if (!config.enabled || !config.endpoint || !config.key) {
    console.log("SKIP Azure photo live smoke: SEMA_ENABLE_AZURE_PHOTO_MODERATION, AZURE_CONTENT_SAFETY_ENDPOINT, and AZURE_CONTENT_SAFETY_KEY are required.");
    return;
  }

  const bytes = createSyntheticBenignPng();
  try {
    const image = validateSyntheticImage(bytes);
    const startedAt = Date.now();
    const result = await requestAzurePhotoModeration({
      endpoint: config.endpoint,
      key: config.key,
      rawBase64: bytes.toString("base64"),
      config
    });

    if (!result.ok) {
      console.error(sanitizedFailure(result.code, image, result.providerError));
      process.exitCode = 1;
      return;
    }

    console.log("Azure photo live smoke passed");
    console.log(JSON.stringify({
      provider: "azure_content_safety",
      outcome: "completed",
      moderationOutcome: result.outcome,
      latencyMs: Date.now() - startedAt,
      categoryChecked: "Sexual",
      outputType: "FourSeverityLevels",
      syntheticFixture: "colored_shapes_png",
      image
    }));
  } finally {
    bytes.fill(0);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    provider: "azure_content_safety",
    outcome: "failed",
    code: "smoke_exception",
    message: error instanceof Error ? error.message.slice(0, 500) : "Azure photo live smoke failed."
  }));
  process.exitCode = 1;
});
