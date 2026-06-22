import type { AgentAction } from "@/lib/agent/agentTypes";
import type { LiveToolCall } from "../liveTypes";

export type WriteToolProbeStage =
  | "initialization"
  | "configuration"
  | "creating_ephemeral_token"
  | "opening_socket"
  | "dispatching_setup"
  | "waiting_for_setup_complete"
  | "sending_write_request"
  | "waiting_for_write_tool_call"
  | "validating_write_tool_call"
  | "checking_canonical_registry"
  | "evaluating_permission_gate"
  | "sending_confirmation_required_response"
  | "waiting_for_permission_acknowledgement"
  | "validating_no_early_completion_claim"
  | "closing_session"
  | "cleanup";

export type WriteToolProbeErrorCode =
  | "child_start_failed"
  | "runner_load_failed"
  | "probe_not_idle_before_write_request"
  | "token_creation_failed"
  | "socket_open_failed"
  | "setup_timeout"
  | "write_prompt_dispatch_failed"
  | "write_tool_timeout"
  | "model_spoke_instead_of_tool"
  | "turn_completed_without_tool"
  | "unexpected_tool_called"
  | "write_tool_payload_invalid"
  | "write_tool_missing_id"
  | "canonical_action_missing"
  | "permission_gate_incorrect"
  | "session_mutated_before_confirmation"
  | "tool_response_failed"
  | "permission_acknowledgement_timeout"
  | "early_completion_claim"
  | "provider_error"
  | "rate_limited"
  | "socket_closed_early"
  | "global_timeout"
  | "child_global_timeout"
  | "parent_watchdog_timeout"
  | "child_exit_without_terminal_record"
  | "invalid_event_protocol"
  | "unknown_error";

export type SanitizedWriteProbeEvent =
  | "socket_open"
  | "setup_sent"
  | "setup_complete"
  | "write_prompt_sent"
  | "server_audio_received"
  | "output_transcript_received"
  | "tool_call_received"
  | "unexpected_tool_received"
  | "turn_complete_received"
  | "tool_call_cancelled"
  | "provider_error_received"
  | "socket_closed"
  | "cleanup_complete";

export type SanitizedWriteProbeEventRecord = {
  event: SanitizedWriteProbeEvent;
  elapsedMs: number;
  toolName?: string;
  functionCallCount?: number;
  transcriptCharacterCount?: number;
};

export type ProbeCheck = boolean | "not_run";

export type WriteToolProbeResult = {
  test: "gemini_live_write_tool_probe";
  passed: boolean;
  provider: "gemini_live";
  model: string;
  voice: string;
  fallbackUsed: false;
  tokenCreated: ProbeCheck;
  socketOpened: ProbeCheck;
  setupCompleted: ProbeCheck;
  writePromptSent: ProbeCheck;
  writeToolProposed: ProbeCheck;
  writeToolNameValid: ProbeCheck;
  writeToolPayloadValid: ProbeCheck;
  canonicalRegistryValidated: ProbeCheck;
  permissionRequired: ProbeCheck;
  actionExecuted: ProbeCheck;
  sessionMutated: ProbeCheck;
  permissionResponseSent: ProbeCheck;
  permissionAcknowledgementReceived: ProbeCheck;
  earlyCompletionClaimDetected: ProbeCheck;
  failedStage?: WriteToolProbeStage;
  errorCode?: WriteToolProbeErrorCode;
  socketClosed: boolean;
  cleanupCompleted: boolean;
  sanitizedEvents: SanitizedWriteProbeEventRecord[];
  latencyMs: number;
};

export type WriteToolProbeConfiguration = {
  provider: "gemini_live";
  model: string;
  voice: string;
  fallbackUsed: false;
};

export type WriteToolProbePermissionResult = {
  permissionRequired: boolean;
  actionExecuted: false;
  sessionMutated: false;
};

export interface WriteToolProbeDriver {
  initialize(): Promise<void>;
  loadConfiguration(): Promise<WriteToolProbeConfiguration>;
  createEphemeralToken(): Promise<void>;
  openSocket(): Promise<void>;
  dispatchSetup(): Promise<void>;
  waitForSetupComplete(): Promise<void>;
  sendWriteRequest(): Promise<void>;
  waitForWriteToolCall(): Promise<void>;
  validateWriteToolCall(): Promise<LiveToolCall>;
  checkCanonicalRegistry(): Promise<AgentAction>;
  evaluatePermissionGate(): Promise<WriteToolProbePermissionResult>;
  sendConfirmationRequiredResponse(): Promise<void>;
  waitForPermissionAcknowledgement(): Promise<void>;
  validateNoEarlyCompletionClaim(): Promise<void>;
  closeSocket(): Promise<void>;
  cleanup(): Promise<{ socketClosed: boolean; cleanupCompleted: boolean }>;
  getSanitizedEvents(): SanitizedWriteProbeEventRecord[];
}
