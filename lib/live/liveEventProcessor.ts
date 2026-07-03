import type { LiveToolCall } from "./liveTypes";

export type NormalizedToolCall = LiveToolCall & { partIndex?: number };

export type NormalizedLiveServerEvent = {
  connectionEpoch: number;
  responseEpoch: number;
  eventSequence: number;
  audioChunks: Array<{ data: string; mimeType?: string; partIndex: number }>;
  textParts: Array<{ text: string; partIndex: number }>;
  inputTranscript?: string;
  inputTranscriptFinal: boolean;
  outputTranscript?: string;
  toolCalls: NormalizedToolCall[];
  generationComplete: boolean;
  turnComplete: boolean;
  interrupted: boolean;
};

type LivePartDedupKind = "audio" | "text" | "tool";
export type LivePartDedupKey = `${number}:${number}:${number}:${number}:${LivePartDedupKind}`;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function textOf(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function isValidLiveAudioBase64(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function isLiveAudioMimeType(mimeType: unknown) {
  if (mimeType === undefined) return true;
  if (typeof mimeType !== "string") return false;
  return /^audio\/pcm(?:;|$)/i.test(mimeType.trim());
}

export function livePartDedupKey(input: {
  connectionEpoch: number;
  responseEpoch: number;
  eventSequence: number;
  partIndex: number;
  kind: LivePartDedupKind;
}): LivePartDedupKey {
  return `${input.connectionEpoch}:${input.responseEpoch}:${input.eventSequence}:${input.partIndex}:${input.kind}`;
}

export function normalizeGeminiLiveServerEvent(message: unknown, input: {
  connectionEpoch: number;
  responseEpoch: number;
  eventSequence: number;
  seen?: Set<LivePartDedupKey>;
}): NormalizedLiveServerEvent {
  const record = asRecord(message) ?? {};
  const serverContent = asRecord(record.serverContent);
  const modelTurn = asRecord(serverContent?.modelTurn);
  const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
  const seen = input.seen;
  const event: NormalizedLiveServerEvent = {
    connectionEpoch: input.connectionEpoch,
    responseEpoch: input.responseEpoch,
    eventSequence: input.eventSequence,
    audioChunks: [],
    textParts: [],
    inputTranscriptFinal: false,
    toolCalls: [],
    generationComplete: serverContent?.generationComplete === true,
    turnComplete: serverContent?.turnComplete === true,
    interrupted: serverContent?.interrupted === true
  };

  parts.forEach((rawPart, partIndex) => {
    const part = asRecord(rawPart);
    if (!part) return;
    const inlineData = asRecord(part.inlineData);
    const audioData = inlineData?.data;
    const audioMimeType = inlineData?.mimeType;
    if (isValidLiveAudioBase64(audioData) && isLiveAudioMimeType(audioMimeType)) {
      const key = livePartDedupKey({ ...input, partIndex, kind: "audio" });
      if (!seen?.has(key)) {
        seen?.add(key);
        event.audioChunks.push({ data: audioData, mimeType: typeof audioMimeType === "string" ? audioMimeType : undefined, partIndex });
      }
    }

    const text = textOf(part.text);
    if (text) {
      const key = livePartDedupKey({ ...input, partIndex, kind: "text" });
      if (!seen?.has(key)) {
        seen?.add(key);
        event.textParts.push({ text, partIndex });
      }
    }

    const functionCall = asRecord(part.functionCall);
    const id = textOf(functionCall?.id);
    const name = textOf(functionCall?.name);
    if (id && name) {
      const key = livePartDedupKey({ ...input, partIndex, kind: "tool" });
      if (!seen?.has(key)) {
        seen?.add(key);
        event.toolCalls.push({ id, name, args: asRecord(functionCall?.args) ?? {}, partIndex });
      }
    }
  });

  const topLevelData = record.data;
  if (isValidLiveAudioBase64(topLevelData)) {
    const partIndex = -1;
    const key = livePartDedupKey({ ...input, partIndex, kind: "audio" });
    const alreadyCollectedFromParts = event.audioChunks.some((chunk) => chunk.data === topLevelData);
    if (!alreadyCollectedFromParts && !seen?.has(key)) {
      seen?.add(key);
      event.audioChunks.push({ data: topLevelData, partIndex });
    }
  }

  const inputFinal = textOf(asRecord(serverContent?.inputTranscription)?.text);
  const inputInterim = textOf(asRecord(serverContent?.interimInputTranscription)?.text);
  event.inputTranscript = inputFinal ?? inputInterim;
  event.inputTranscriptFinal = Boolean(inputFinal);
  event.outputTranscript = textOf(asRecord(serverContent?.outputTranscription)?.text);

  const functionCalls = Array.isArray(asRecord(record.toolCall)?.functionCalls) ? asRecord(record.toolCall)?.functionCalls as unknown[] : [];
  functionCalls.forEach((rawCall, index) => {
    const call = asRecord(rawCall);
    const id = textOf(call?.id);
    const name = textOf(call?.name);
    if (!id || !name) return;
    const partIndex = parts.length + index;
    const key = livePartDedupKey({ ...input, partIndex, kind: "tool" });
    if (!seen?.has(key)) {
      seen?.add(key);
      event.toolCalls.push({ id, name, args: asRecord(call?.args) ?? {}, partIndex });
    }
  });

  if (Array.isArray(asRecord(record.toolCallCancellation)?.ids) && (asRecord(record.toolCallCancellation)?.ids as unknown[]).length > 0) {
    event.interrupted = true;
  }

  return event;
}
