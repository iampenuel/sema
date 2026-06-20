import type { LiveErrorCode } from "./liveTypes";

export function classifyLiveError(error: unknown): { code: LiveErrorCode; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown Live error");
  const text = raw.toLowerCase();
  if (text.includes("429") || text.includes("rate limit") || text.includes("resource_exhausted")) return { code: "rate_limited", message: "Gemini Live is temporarily rate limited." };
  if (text.includes("timeout") || text.includes("timed out") || text.includes("deadline")) return { code: "timeout", message: "The Gemini Live connection timed out." };
  if (text.includes("permission") || text.includes("notallowederror")) return { code: "microphone_denied", message: "Microphone access was not allowed." };
  if (text.includes("expired")) return { code: "session_expired", message: "The Live session expired." };
  return { code: "connection_failed", message: "Sema Live could not connect. Text interaction is still available." };
}
