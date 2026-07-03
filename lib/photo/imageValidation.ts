export function supportedModerationMimeType(type: string) {
  return type === "image/jpeg";
}

export function supportedSmokeMimeType(type: string) {
  return type === "image/jpeg" || type === "image/png";
}

export function hasSupportedImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") {
    return bytes.length > 24
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  return mimeType === "image/jpeg" && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function readUint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) + bytes[offset + 1];
}

export function readImageDimensions(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png" && hasSupportedImageSignature(bytes, mimeType) && bytes.length >= 24) {
    return {
      width: (bytes[16] * 2 ** 24) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19],
      height: (bytes[20] * 2 ** 24) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23]
    };
  }
  if (mimeType !== "image/jpeg" || bytes.length < 4 || !hasSupportedImageSignature(bytes, mimeType)) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    const length = readUint16(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return undefined;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: readUint16(bytes, offset + 5), width: readUint16(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

export function validateModerationImageDimensions(bytes: Uint8Array, mimeType: string, minimum = 50, maximum = 2_048) {
  const dimensions = readImageDimensions(bytes, mimeType);
  if (!dimensions) return { ok: false as const, code: "invalid_image" as const };
  if (dimensions.width < minimum || dimensions.height < minimum) return { ok: false as const, code: "too_small" as const, dimensions };
  if (dimensions.width > maximum || dimensions.height > maximum) return { ok: false as const, code: "too_wide" as const, dimensions };
  return { ok: true as const, dimensions };
}
