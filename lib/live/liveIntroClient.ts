import {
  normalizeGeminiServerFrame,
  parseNormalizedGeminiServerFrame,
  unsupportedGeminiServerFrameResult,
  type LiveIntroInboundMessageMetadata
} from "./liveIntroFrame";
import type { LiveIntroParsedEvent } from "./liveIntroParser";
import type { GeminiLiveIntroSetupMessage } from "./liveIntroControl";
import type { LiveToolCall } from "./liveTypes";

type WebSocketConstructor = typeof WebSocket;
export type LiveIntroClientCloseReason = "setup_timeout" | "user_stop" | "component_cleanup" | "retry_replacement" | "session_complete" | "unknown";
export type LiveIntroCloseInitiator = "client" | "provider";

export type LiveIntroClientCallbacks = {
  onOpen?: () => void;
  onMessage: (events: LiveIntroParsedEvent[], metadata: LiveIntroInboundMessageMetadata) => void;
  onClose?: (event: Pick<CloseEvent, "code" | "reason" | "wasClean">, metadata: {
    closeInitiator: LiveIntroCloseInitiator;
    clientCloseReasonCategory?: LiveIntroClientCloseReason;
    clientCloseRequestedAt?: number;
    providerCloseObservedAt?: number;
  }) => void;
  onError?: () => void;
};

export const GEMINI_LIVE_INTRO_WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

function resolveWebSocketConstructor(): WebSocketConstructor | undefined {
  return typeof WebSocket === "undefined" ? undefined : WebSocket;
}

export function buildGeminiLiveIntroWebSocketUrl(token: string) {
  return `${GEMINI_LIVE_INTRO_WS_BASE}?access_token=${encodeURIComponent(token)}`;
}

export class GeminiLiveIntroClient {
  private socket?: WebSocket;
  private inboundMessageChain: Promise<void> = Promise.resolve();
  private clientCloseReasonCategory?: LiveIntroClientCloseReason;
  private clientCloseRequestedAt?: number;

  constructor(
    private readonly callbacks: LiveIntroClientCallbacks,
    private readonly webSocketFactory = resolveWebSocketConstructor()
  ) {}

  connect(token: string) {
    const WebSocketCtor = this.webSocketFactory;
    if (!WebSocketCtor) return Promise.reject(new Error("WebSocket unavailable"));
    if (!token) return Promise.reject(new Error("Live token missing"));
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const socket = new WebSocketCtor(buildGeminiLiveIntroWebSocketUrl(token));
      this.socket = socket;
      socket.onopen = () => {
        opened = true;
        this.callbacks.onOpen?.();
        resolve();
      };
      socket.onerror = () => {
        this.callbacks.onError?.();
        if (!opened) reject(new Error("WebSocket connection failed"));
      };
      socket.onclose = (event) => {
        const clientCloseRequestedAt = this.clientCloseRequestedAt;
        const providerCloseObservedAt = clientCloseRequestedAt ? undefined : Date.now();
        this.callbacks.onClose?.(
          { code: event.code, reason: event.reason, wasClean: event.wasClean },
          {
            closeInitiator: clientCloseRequestedAt ? "client" : "provider",
            clientCloseReasonCategory: this.clientCloseReasonCategory,
            clientCloseRequestedAt,
            providerCloseObservedAt
          }
        );
        if (!opened) reject(new Error("WebSocket closed before open"));
      };
      socket.onmessage = (event) => {
        this.inboundMessageChain = this.inboundMessageChain
          .catch(() => undefined)
          .then(() => this.processInboundFrame(event.data))
          .catch(() => {
            const result = unsupportedGeminiServerFrameResult();
            this.callbacks.onMessage(result.events, result.metadata);
          });
      };
    });
  }

  sendSetup(message: GeminiLiveIntroSetupMessage) {
    this.sendJson(message);
  }

  sendIntro(text: string) {
    this.sendJson({ realtimeInput: { text } });
  }

  sendAudio(data: string, sampleRate: number) {
    this.sendJson({ realtimeInput: { audio: { data, mimeType: `audio/pcm;rate=${sampleRate}` } } });
  }

  endAudio() {
    this.sendJson({ realtimeInput: { audioStreamEnd: true } });
  }

  sendToolResponse(call: LiveToolCall, response: Record<string, unknown>) {
    this.sendJson({
      toolResponse: {
        functionResponses: [
          {
            id: call.id,
            name: call.name,
            response
          }
        ]
      }
    });
  }

  close(reason: LiveIntroClientCloseReason = "unknown") {
    if (this.socket && !this.clientCloseRequestedAt) {
      this.clientCloseRequestedAt = Date.now();
      this.clientCloseReasonCategory = reason;
    }
    this.socket?.close();
    this.socket = undefined;
  }

  private sendJson(value: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open");
    this.socket.send(JSON.stringify(value));
  }

  private async processInboundFrame(data: unknown) {
    try {
      const frame = await normalizeGeminiServerFrame(data);
      const result = parseNormalizedGeminiServerFrame(frame);
      this.callbacks.onMessage(result.events, result.metadata);
    } catch {
      const result = unsupportedGeminiServerFrameResult();
      this.callbacks.onMessage(result.events, result.metadata);
    }
  }
}
