import type { LiveIntroFailureBoundary } from "./liveIntroControl";
import type { LiveToolCall } from "./liveTypes";

export type LiveIntroParsedEvent =
  | { type: "setup_complete" }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "audio_missing_data"; mimeType: string }
  | { type: "unsupported_audio_mime"; mimeType: string }
  | { type: "output_transcript"; text: string; final: boolean }
  | { type: "output_text"; text: string }
  | { type: "generation_complete" }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "tool_call"; calls: LiveToolCall[] }
  | { type: "go_away" }
  | { type: "session_resumption_update" }
  | { type: "server_content_without_model_content" }
  | { type: "provider_error"; code?: string | number; status?: string; category: LiveIntroProviderErrorCategory }
  | { type: "unrecognized_server_message" }
  | { type: "parse_error"; boundary: LiveIntroFailureBoundary };

type JsonRecord = Record<string, unknown>;

export type LiveIntroCanonicalKind =
  | "setup_complete"
  | "server_content"
  | "tool_call"
  | "tool_call_cancellation"
  | "go_away"
  | "session_resumption_update"
  | "provider_error"
  | "usage_metadata_only"
  | "unknown"
  | "invalid_json"
  | "unsupported_frame_type"
  | "invalid_json_root";

export type LiveIntroProviderErrorCategory =
  | "invalid_argument"
  | "unauthenticated"
  | "permission_denied"
  | "model_not_found"
  | "unsupported_configuration"
  | "quota_or_capacity"
  | "internal_provider_error"
  | "unknown_provider_error";

export type LiveIntroServerMessageClassification = {
  topLevelKeys: string[];
  topLevelKeyCount: number;
  canonicalKind: LiveIntroCanonicalKind;
  setupCompletePropertyPresent: boolean;
  providerErrorCode?: string | number;
  providerErrorStatus?: string;
  providerErrorCategory?: LiveIntroProviderErrorCategory;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getEither(record: JsonRecord, camelName: string, snakeName: string) {
  return record[camelName] ?? record[snakeName];
}

function hasEither(record: JsonRecord, camelName: string, snakeName: string) {
  return Object.prototype.hasOwnProperty.call(record, camelName) || Object.prototype.hasOwnProperty.call(record, snakeName);
}

export function isLiveIntroAudioMimeType(value: unknown) {
  return typeof value === "string" && value.toLowerCase().startsWith("audio/pcm");
}

function textFromTranscription(value: unknown) {
  if (!isRecord(value)) return "";
  return typeof value.text === "string" ? value.text : "";
}

function partsFromModelTurn(value: unknown) {
  if (!isRecord(value)) return [];
  return Array.isArray(value.parts) ? value.parts : [];
}

function stableArgs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseFunctionCalls(value: unknown): LiveToolCall[] {
  const source = isRecord(value) ? value : {};
  const calls = Array.isArray(source.functionCalls)
    ? source.functionCalls
    : Array.isArray(source.function_calls)
      ? source.function_calls
      : [];
  return calls.filter(isRecord).map((call, index) => ({
    id: typeof call.id === "string" && call.id ? call.id : `tool-${index}`,
    name: typeof call.name === "string" ? call.name : "",
    args: stableArgs(call.args)
  })).filter((call) => call.name);
}

function parsePartFunctionCall(part: JsonRecord): LiveToolCall[] {
  const call = getEither(part, "functionCall", "function_call");
  if (!isRecord(call)) return [];
  return [{
    id: typeof call.id === "string" && call.id ? call.id : `${String(call.name ?? "tool")}-part`,
    name: typeof call.name === "string" ? call.name : "",
    args: stableArgs(call.args)
  }].filter((item) => item.name);
}

function sanitizeTopLevelKey(key: string) {
  return key.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

export function safeTopLevelKeys(value: unknown) {
  if (!isRecord(value)) return [];
  return Object.keys(value).map(sanitizeTopLevelKey).filter(Boolean).slice(0, 12);
}

function safeProviderErrorCode(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function safeProviderErrorStatus(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

function providerErrorCategory(status: string | undefined, code: string | number | undefined): LiveIntroProviderErrorCategory {
  const normalized = String(status ?? code ?? "").toLowerCase();
  if (normalized.includes("invalid_argument") || normalized === "400") return "invalid_argument";
  if (normalized.includes("unauthenticated") || normalized === "401") return "unauthenticated";
  if (normalized.includes("permission_denied") || normalized === "403") return "permission_denied";
  if (normalized.includes("not_found") || normalized === "404") return "model_not_found";
  if (normalized.includes("failed_precondition") || normalized.includes("unimplemented")) return "unsupported_configuration";
  if (normalized.includes("resource_exhausted") || normalized === "429") return "quota_or_capacity";
  if (normalized.includes("internal") || normalized.includes("unavailable") || normalized === "500" || normalized === "503") return "internal_provider_error";
  return "unknown_provider_error";
}

function classifyProviderError(value: unknown) {
  const error = isRecord(value) ? value : {};
  const code = safeProviderErrorCode(error.code);
  const status = safeProviderErrorStatus(error.status);
  return { code, status, category: providerErrorCategory(status, code) };
}

export function classifyGeminiLiveIntroServerMessage(input: unknown): LiveIntroServerMessageClassification {
  if (!isRecord(input)) {
    return {
      topLevelKeys: [],
      topLevelKeyCount: 0,
      canonicalKind: "invalid_json_root",
      setupCompletePropertyPresent: false
    };
  }

  const topLevelKeys = safeTopLevelKeys(input);
  const setupCompletePropertyPresent = Object.prototype.hasOwnProperty.call(input, "setupComplete");
  if (setupCompletePropertyPresent || Object.prototype.hasOwnProperty.call(input, "setup_complete")) {
    return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "setup_complete", setupCompletePropertyPresent };
  }
  if (hasEither(input, "serverContent", "server_content")) return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "server_content", setupCompletePropertyPresent };
  if (hasEither(input, "toolCall", "tool_call")) return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "tool_call", setupCompletePropertyPresent };
  if (hasEither(input, "toolCallCancellation", "tool_call_cancellation")) return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "tool_call_cancellation", setupCompletePropertyPresent };
  if (hasEither(input, "goAway", "go_away")) return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "go_away", setupCompletePropertyPresent };
  if (hasEither(input, "sessionResumptionUpdate", "session_resumption_update")) return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "session_resumption_update", setupCompletePropertyPresent };
  if (Object.prototype.hasOwnProperty.call(input, "error")) {
    const provider = classifyProviderError(input.error);
    return {
      topLevelKeys,
      topLevelKeyCount: Object.keys(input).length,
      canonicalKind: "provider_error",
      setupCompletePropertyPresent,
      providerErrorCode: provider.code,
      providerErrorStatus: provider.status,
      providerErrorCategory: provider.category
    };
  }
  if (hasEither(input, "usageMetadata", "usage_metadata") && Object.keys(input).length === 1) {
    return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "usage_metadata_only", setupCompletePropertyPresent };
  }
  return { topLevelKeys, topLevelKeyCount: Object.keys(input).length, canonicalKind: "unknown", setupCompletePropertyPresent };
}

export function parseGeminiLiveIntroServerMessage(input: unknown): LiveIntroParsedEvent[] {
  const record: unknown = input;
  if (!isRecord(record)) return [{ type: "parse_error", boundary: "unknown" }];

  const events: LiveIntroParsedEvent[] = [];
  if (hasEither(record, "setupComplete", "setup_complete")) events.push({ type: "setup_complete" });
  if (hasEither(record, "goAway", "go_away")) events.push({ type: "go_away" });
  if (hasEither(record, "sessionResumptionUpdate", "session_resumption_update")) events.push({ type: "session_resumption_update" });
  if (hasEither(record, "toolCall", "tool_call")) events.push({ type: "tool_call", calls: parseFunctionCalls(getEither(record, "toolCall", "tool_call")) });
  if (Object.prototype.hasOwnProperty.call(record, "error")) {
    const provider = classifyProviderError(record.error);
    events.push({ type: "provider_error", code: provider.code, status: provider.status, category: provider.category });
  }

  const maybeServerContent = getEither(record, "serverContent", "server_content");
  const serverContent = isRecord(maybeServerContent) ? maybeServerContent : undefined;
  if (serverContent) {
    const maybeModelTurn = getEither(serverContent, "modelTurn", "model_turn");
    const modelTurn = isRecord(maybeModelTurn) ? maybeModelTurn : undefined;
    const parts = partsFromModelTurn(modelTurn);
    if (serverContent.interrupted === true) events.push({ type: "interrupted" });
    if (serverContent.generationComplete === true || serverContent.generation_complete === true) events.push({ type: "generation_complete" });
    if (serverContent.turnComplete === true || serverContent.turn_complete === true) events.push({ type: "turn_complete" });
    const outputTranscript = textFromTranscription(getEither(serverContent, "outputTranscription", "output_transcription"));
    const generationOrTurnComplete = Boolean(serverContent.generationComplete || serverContent.generation_complete || serverContent.turnComplete || serverContent.turn_complete);
    if (outputTranscript) events.push({ type: "output_transcript", text: outputTranscript, final: generationOrTurnComplete });
    if (!modelTurn && !outputTranscript && !generationOrTurnComplete && !serverContent.interrupted) {
      events.push({ type: "server_content_without_model_content" });
    }

    for (const part of parts) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string" && part.text.trim()) events.push({ type: "output_text", text: part.text });
      const partCalls = parsePartFunctionCall(part);
      if (partCalls.length) events.push({ type: "tool_call", calls: partCalls });
      const maybeInlineData = getEither(part, "inlineData", "inline_data");
      const inlineData = isRecord(maybeInlineData) ? maybeInlineData : undefined;
      if (!inlineData) continue;
      const mimeTypeValue = getEither(inlineData, "mimeType", "mime_type");
      const mimeType = typeof mimeTypeValue === "string" ? mimeTypeValue : "";
      const data = typeof inlineData.data === "string" ? inlineData.data : "";
      if (!isLiveIntroAudioMimeType(mimeType)) {
        events.push({ type: "unsupported_audio_mime", mimeType });
      } else if (!data) {
        events.push({ type: "audio_missing_data", mimeType });
      } else {
        events.push({ type: "audio", data, mimeType });
      }
    }
  }

  if (!events.length) events.push({ type: "unrecognized_server_message" });
  return events;
}
