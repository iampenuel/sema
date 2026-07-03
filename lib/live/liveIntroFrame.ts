import {
  classifyGeminiLiveIntroServerMessage,
  parseGeminiLiveIntroServerMessage,
  type LiveIntroCanonicalKind,
  type LiveIntroParsedEvent,
  type LiveIntroProviderErrorCategory
} from "./liveIntroParser";

export type ServerFrameType = "string" | "blob" | "arraybuffer" | "arraybuffer_view" | "unsupported";
export type ServerJsonRootType = "object" | "array" | "string" | "number" | "boolean" | "null" | "unavailable";

export type NormalizedServerFrame = {
  text: string;
  frameType: ServerFrameType;
  byteLength: number;
};

export type LiveIntroInboundMessageMetadata = {
  frameType: ServerFrameType;
  byteLength: number;
  normalizationSucceeded: boolean;
  jsonParseSucceeded: boolean;
  jsonRootType: ServerJsonRootType;
  topLevelKeys: string[];
  topLevelKeyCount: number;
  canonicalKind: LiveIntroCanonicalKind;
  setupCompletePropertyPresent: boolean;
  providerErrorCode?: string | number;
  providerErrorStatus?: string;
  providerErrorCategory?: LiveIntroProviderErrorCategory;
};

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export async function normalizeGeminiServerFrame(data: unknown): Promise<NormalizedServerFrame> {
  if (typeof data === "string") {
    return { text: data, frameType: "string", byteLength: utf8ByteLength(data) };
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return { text: await data.text(), frameType: "blob", byteLength: data.size };
  }
  if (data instanceof ArrayBuffer) {
    return { text: new TextDecoder().decode(data), frameType: "arraybuffer", byteLength: data.byteLength };
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return { text: new TextDecoder().decode(bytes), frameType: "arraybuffer_view", byteLength: data.byteLength };
  }
  throw new Error("unsupported_server_frame_type");
}

export function serverJsonRootType(value: unknown): ServerJsonRootType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unavailable";
}

function unsupportedMetadata(): LiveIntroInboundMessageMetadata {
  return {
    frameType: "unsupported",
    byteLength: 0,
    normalizationSucceeded: false,
    jsonParseSucceeded: false,
    jsonRootType: "unavailable",
    topLevelKeys: [],
    topLevelKeyCount: 0,
    canonicalKind: "unsupported_frame_type",
    setupCompletePropertyPresent: false
  };
}

export function unsupportedGeminiServerFrameResult() {
  return {
    events: [{ type: "parse_error", boundary: "unknown" }] satisfies LiveIntroParsedEvent[],
    metadata: unsupportedMetadata()
  };
}

export function parseNormalizedGeminiServerFrame(frame: NormalizedServerFrame): {
  events: LiveIntroParsedEvent[];
  metadata: LiveIntroInboundMessageMetadata;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.text) as unknown;
  } catch {
    return {
      events: [{ type: "parse_error", boundary: "unknown" }],
      metadata: {
        frameType: frame.frameType,
        byteLength: frame.byteLength,
        normalizationSucceeded: true,
        jsonParseSucceeded: false,
        jsonRootType: "unavailable",
        topLevelKeys: [],
        topLevelKeyCount: 0,
        canonicalKind: "invalid_json",
        setupCompletePropertyPresent: false
      }
    };
  }

  const rootType = serverJsonRootType(parsed);
  if (rootType !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      events: [{ type: "parse_error", boundary: "unknown" }],
      metadata: {
        frameType: frame.frameType,
        byteLength: frame.byteLength,
        normalizationSucceeded: true,
        jsonParseSucceeded: true,
        jsonRootType: rootType,
        topLevelKeys: [],
        topLevelKeyCount: 0,
        canonicalKind: "invalid_json_root",
        setupCompletePropertyPresent: false
      }
    };
  }

  const classification = classifyGeminiLiveIntroServerMessage(parsed);
  return {
    events: parseGeminiLiveIntroServerMessage(parsed),
    metadata: {
      frameType: frame.frameType,
      byteLength: frame.byteLength,
      normalizationSucceeded: true,
      jsonParseSucceeded: true,
      jsonRootType: rootType,
      topLevelKeys: classification.topLevelKeys,
      topLevelKeyCount: classification.topLevelKeyCount,
      canonicalKind: classification.canonicalKind,
      setupCompletePropertyPresent: classification.setupCompletePropertyPresent,
      providerErrorCode: classification.providerErrorCode,
      providerErrorStatus: classification.providerErrorStatus,
      providerErrorCategory: classification.providerErrorCategory
    }
  };
}
