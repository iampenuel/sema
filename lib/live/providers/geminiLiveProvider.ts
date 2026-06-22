"use client";

import { ActivityHandling, EndSensitivity, GoogleGenAI, Modality, StartSensitivity, type Session } from "@google/genai";
import type { LiveProvider, LiveProviderEvent, LiveTokenResponse, LiveToolCall } from "../liveTypes";
import { classifyLiveError } from "../liveErrors";
import { LIVE_FUNCTION_DECLARATIONS } from "../liveTools";
import { LIVE_CONTEXT_WINDOW_COMPRESSION } from "../liveConfigCore";

export class GeminiLiveProvider implements LiveProvider {
  private session?: Session;
  private onEvent?: (event: LiveProviderEvent) => void;
  private generation = 0;

  async connect(token: LiveTokenResponse, onEvent: (event: LiveProviderEvent) => void) {
    this.onEvent = onEvent;
    const client = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: "v1alpha" } });
    this.session = await client.live.connect({
      model: token.model,
      callbacks: {
        onopen: () => onEvent({ type: "open" }),
        onclose: (event) => onEvent({ type: "close", reason: event.reason }),
        onerror: (event) => {
          const safe = classifyLiveError(event.message);
          onEvent({ type: "error", ...safe });
        },
        onmessage: (message) => {
          if (message.serverContent?.interrupted) {
            this.generation += 1;
            onEvent({ type: "interrupted" });
          }
          if (message.data) onEvent({ type: "audio", data: message.data, generation: this.generation });
          const input = message.serverContent?.inputTranscription?.text ?? message.serverContent?.interimInputTranscription?.text;
          if (input) onEvent({ type: "input_transcript", text: input, final: Boolean(message.serverContent?.inputTranscription?.text) });
          const output = message.serverContent?.outputTranscription?.text;
          if (output) onEvent({ type: "output_transcript", text: output, final: Boolean(message.serverContent?.turnComplete) });
          for (const call of message.toolCall?.functionCalls ?? []) {
            if (call.id && call.name) onEvent({ type: "tool_call", call: { id: call.id, name: call.name, args: call.args ?? {} } });
          }
          if (message.toolCallCancellation?.ids?.length) onEvent({ type: "interrupted" });
          if (message.serverContent?.generationComplete) onEvent({ type: "generation_complete" });
          if (message.serverContent?.turnComplete) onEvent({ type: "turn_complete" });
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        contextWindowCompression: LIVE_CONTEXT_WINDOW_COMPRESSION,
        realtimeInputConfig: {
          activityHandling: ActivityHandling.NO_INTERRUPTION,
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
            prefixPaddingMs: 100,
            silenceDurationMs: 350
          }
        },
        tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }]
      }
    });
  }

  sendAudio(data: string) { this.session?.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } }); }
  sendText(text: string) { if (text) this.session?.sendRealtimeInput({ text }); }
  sendContextDelta(delta: string) { if (delta) this.session?.sendClientContent({ turns: [{ role: "user", parts: [{ text: `[Sema workspace update]\n${delta}` }] }], turnComplete: false }); }
  sendToolResult(call: LiveToolCall, result: { ok: boolean; message: string }) { this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: result.ok ? { output: result.message } : { error: result.message } }] }); }
  endAudio() { this.session?.sendRealtimeInput({ audioStreamEnd: true }); }
  close() { this.session?.close(); this.session = undefined; this.onEvent = undefined; }
}
