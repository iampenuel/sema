export type WriteProbeLifecycleEvent =
  | "child_started" | "loading_runner" | "runner_loaded" | "probe_starting"
  | "token_request_start" | "token_created" | "socket_opening" | "socket_open"
  | "setup_sent" | "setup_complete" | "write_prompt_sent" | "waiting_for_tool"
  | "tool_call_received" | "permission_checked" | "tool_response_sent"
  | "waiting_for_acknowledgement" | "closing_socket" | "cleanup_start" | "cleanup_complete";

export type WriteProbeProcessEvent =
  | { type: "lifecycle"; event: WriteProbeLifecycleEvent; elapsedMs: number; toolName?: string }
  | { type: "heartbeat"; stage: "waiting_for_tool" | "waiting_for_acknowledgement"; elapsedMs: number }
  | {
      type: "terminal"; passed: boolean; errorCode?: string; failedStage?: string;
      cleanupCompleted: boolean; fallbackUsed: false; result?: Record<string, unknown>;
    };

const lifecycleEvents = new Set<WriteProbeLifecycleEvent>([
  "child_started", "loading_runner", "runner_loaded", "probe_starting", "token_request_start",
  "token_created", "socket_opening", "socket_open", "setup_sent", "setup_complete",
  "write_prompt_sent", "waiting_for_tool", "tool_call_received", "permission_checked",
  "tool_response_sent", "waiting_for_acknowledgement", "closing_socket", "cleanup_start", "cleanup_complete"
]);

export function isWriteProbeProcessEvent(value: unknown): value is WriteProbeProcessEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.type === "lifecycle") return lifecycleEvents.has(event.event as WriteProbeLifecycleEvent) && typeof event.elapsedMs === "number";
  if (event.type === "heartbeat") return (event.stage === "waiting_for_tool" || event.stage === "waiting_for_acknowledgement") && typeof event.elapsedMs === "number";
  return event.type === "terminal" && typeof event.passed === "boolean" && typeof event.cleanupCompleted === "boolean" && event.fallbackUsed === false;
}

export function emitProbeEvent(event: WriteProbeProcessEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  return new Promise((resolve) => {
    if (process.stdout.write(line)) resolve();
    else process.stdout.once("drain", resolve);
  });
}

export class JsonLineParser {
  private pending = "";
  constructor(private readonly onLine: (line: string) => void) {}
  push(chunk: string) {
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) this.onLine(line);
  }
  finish() { if (this.pending.trim()) this.onLine(this.pending); this.pending = ""; }
}

export function redactProbeText(text: string): string {
  return text
    .replace(/AIza[\w-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/auth_tokens\/[\w./-]+/g, "[REDACTED_TOKEN]")
    .replace(/([?&](?:access_token|key|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/((?:access_token|api_key|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/wss?:\/\/\S+/gi, "[REDACTED_URL]");
}
