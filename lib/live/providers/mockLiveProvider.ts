import type { LiveProvider, LiveProviderEvent, LiveTokenResponse, LiveToolCall } from "../liveTypes";

export class MockLiveProvider implements LiveProvider {
  events: LiveProviderEvent[] = [];
  audio: string[] = [];
  text: string[] = [];
  context: string[] = [];
  results: Array<{ call: LiveToolCall; result: { ok: boolean; message: string } }> = [];
  closed = false;
  private listener?: (event: LiveProviderEvent) => void;

  async connect(_token: LiveTokenResponse, onEvent: (event: LiveProviderEvent) => void) {
    this.listener = onEvent;
    this.emit({ type: "open" });
  }
  emit(event: LiveProviderEvent) { this.events.push(event); this.listener?.(event); }
  sendAudio(data: string) { this.audio.push(data); }
  sendText(text: string) { this.text.push(text); }
  sendContextDelta(delta: string) { this.context.push(delta); }
  sendToolResult(call: LiveToolCall, result: { ok: boolean; message: string }) { this.results.push({ call, result }); }
  endAudio() { /* deterministic no-op */ }
  close() { this.closed = true; this.listener = undefined; }
}
