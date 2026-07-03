"use client";

import { GoogleGenAI, type Session } from "@google/genai";
import { normalizeGeminiLiveServerEvent, type LivePartDedupKey } from "../liveEventProcessor";
import { buildGeminiLiveSessionConfig } from "../liveSessionConfig";
import type { LiveProvider, LiveProviderEvent, LiveTokenResponse, LiveToolCall } from "../liveTypes";
import { classifyLiveError } from "../liveErrors";

export class GeminiLiveProvider implements LiveProvider {
  private session?: Session;
  private onEvent?: (event: LiveProviderEvent) => void;
  private generation = 0;
  private connectionEpoch = 0;
  private responseEpoch = 1;
  private eventSequence = 0;
  private seenParts = new Set<LivePartDedupKey>();

  async connect(token: LiveTokenResponse, onEvent: (event: LiveProviderEvent) => void) {
    this.onEvent = onEvent;
    const client = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: "v1alpha" } });
    this.session = await client.live.connect({
      model: token.model,
      callbacks: {
        onopen: () => {
          this.connectionEpoch += 1;
          this.eventSequence = 0;
          this.seenParts.clear();
          onEvent({ type: "open" });
        },
        onclose: (event) => onEvent({ type: "close", reason: event.reason }),
        onerror: (event) => {
          const safe = classifyLiveError(event.message);
          onEvent({ type: "error", ...safe });
        },
        onmessage: (message) => {
          const normalized = normalizeGeminiLiveServerEvent(message, {
            connectionEpoch: this.connectionEpoch,
            responseEpoch: this.responseEpoch,
            eventSequence: this.eventSequence,
            seen: this.seenParts
          });
          this.eventSequence += 1;
          if (normalized.interrupted) {
            this.generation += 1;
            onEvent({ type: "interrupted" });
          }
          for (const chunk of normalized.audioChunks) onEvent({ type: "audio", data: chunk.data, generation: this.generation, responseEpoch: normalized.responseEpoch, partIndex: chunk.partIndex });
          if (normalized.inputTranscript) onEvent({ type: "input_transcript", text: normalized.inputTranscript, final: normalized.inputTranscriptFinal });
          for (const textPart of normalized.textParts) onEvent({ type: "output_transcript", text: textPart.text, final: normalized.turnComplete, responseEpoch: normalized.responseEpoch, partIndex: textPart.partIndex });
          if (normalized.outputTranscript) onEvent({ type: "output_transcript", text: normalized.outputTranscript, final: normalized.turnComplete, responseEpoch: normalized.responseEpoch });
          for (const call of normalized.toolCalls) onEvent({ type: "tool_call", call });
          if (normalized.generationComplete) {
            onEvent({ type: "generation_complete" });
            this.responseEpoch += 1;
            this.seenParts.clear();
          }
          if (normalized.turnComplete) onEvent({ type: "turn_complete" });
        }
      },
      config: buildGeminiLiveSessionConfig({ voiceName: token.voiceName || "Kore", thinkingLevel: token.thinkingLevel ?? "medium" })
    });
  }

  sendAudio(data: string) { this.session?.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } }); }
  sendText(text: string) { if (text) this.session?.sendRealtimeInput({ text }); }
  sendContextDelta(delta: string) { if (delta) this.session?.sendClientContent({ turns: [{ role: "user", parts: [{ text: `[Sema workspace update]\n${delta}` }] }], turnComplete: false }); }
  sendToolResult(call: LiveToolCall, result: { ok: boolean; message: string }) { this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: result.ok ? { output: result.message } : { error: result.message } }] }); }
  endAudio() { this.session?.sendRealtimeInput({ audioStreamEnd: true }); }
  close() { this.session?.close(); this.session = undefined; this.onEvent = undefined; }
}
