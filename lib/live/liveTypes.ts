import type { AgentAction } from "@/lib/agent/agentTypes";

export type LiveConnectionState =
  | "idle"
  | "consent_required"
  | "requesting_microphone"
  | "requesting_token"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "awaiting_confirmation"
  | "reconnecting"
  | "ending"
  | "ended"
  | "rate_limited"
  | "unavailable"
  | "error";

export type SemaLiveProviderId = "local_voice" | "gemini_live";

export type LiveErrorCode =
  | "disabled"
  | "consent_declined"
  | "microphone_denied"
  | "token_unavailable"
  | "rate_limited"
  | "timeout"
  | "connection_failed"
  | "safety_blocked"
  | "invalid_tool_call"
  | "session_expired"
  | "unknown";

export type LiveTranscriptLine = {
  id: string;
  role: "user" | "sema" | "system";
  text: string;
  final: boolean;
};

export type LiveToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type PendingLiveAction = {
  call: LiveToolCall;
  action: AgentAction;
};

export type LiveRuntimeState = {
  status: LiveConnectionState;
  consented: boolean;
  microphoneMuted: boolean;
  speakerMuted: boolean;
  transcript: LiveTranscriptLine[];
  pendingAction?: PendingLiveAction;
  error?: { code: LiveErrorCode; message: string };
  reconnectAttempts: number;
  sessionStartedAt?: number;
  activeGeneration: number;
};

export type LivePublicStatus = {
  uiEnabled: boolean;
  available: boolean;
  provider: "gemini_live";
  model: string;
  voiceName: string;
  maxSessionMinutes: number;
  publicDemoTokenEnabled: boolean;
  reason?: string;
};

export type LiveTokenResponse = {
  token: string;
  expiresAt: string;
  model: string;
  voiceName: string;
};

export type LiveProviderEvent =
  | { type: "open" }
  | { type: "close"; reason?: string }
  | { type: "error"; code: LiveErrorCode; message: string }
  | { type: "audio"; data: string; generation: number }
  | { type: "input_transcript"; text: string; final: boolean }
  | { type: "output_transcript"; text: string; final: boolean }
  | { type: "tool_call"; call: LiveToolCall }
  | { type: "interrupted" }
  | { type: "generation_complete" }
  | { type: "turn_complete" };

export interface LiveProvider {
  connect(token: LiveTokenResponse, onEvent: (event: LiveProviderEvent) => void): Promise<void>;
  sendAudio(pcmBase64: string): void;
  sendText(text: string): void;
  sendContextDelta(delta: string): void;
  sendToolResult(call: LiveToolCall, result: { ok: boolean; message: string }): void;
  endAudio(): void;
  close(): void;
}
