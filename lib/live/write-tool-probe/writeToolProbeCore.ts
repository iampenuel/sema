import type { FunctionDeclaration } from "@google/genai";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import type { AgentAction } from "@/lib/agent/agentTypes";
import type { SemaSession } from "@/lib/sema-session/types";
import { initialLiveState, liveStateReducer } from "../liveStateMachine";
import { validateLiveToolCall } from "../liveTools";
import type { LiveToolCall } from "../liveTypes";
import type { SanitizedWriteProbeEventRecord } from "./writeToolProbeTypes";

export const WRITE_TOOL_PROBE_SYSTEM_INSTRUCTION = `You are testing one declared Sema application tool.

When the user explicitly asks you to prepare the evidence packet, call the prepareEvidencePacket function.

Do not say the packet was prepared before the application returns a successful execution result.

If the application reports that screen confirmation is required, tell the user to confirm the action on screen.`;

export const WRITE_TOOL_PROBE_PROMPT = "Prepare my Sema evidence packet now. Use the available prepareEvidencePacket function. Do not answer conversationally instead of proposing the function.";

export const WRITE_TOOL_PROBE_DECLARATION: FunctionDeclaration = {
  name: "prepareEvidencePacket",
  description: "Proposes preparation of the user's Sema evidence packet. The application must request visible user confirmation before execution.",
  parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false }
};

export const WRITE_TOOL_PROBE_DECLARATIONS = [WRITE_TOOL_PROBE_DECLARATION] as const;

export function createWriteRequestRealtimeInput() {
  return { text: WRITE_TOOL_PROBE_PROMPT } as const;
}

export function classifyToollessTurn(hadModelOutput: boolean) {
  return hadModelOutput ? "model_spoke_instead_of_tool" as const : "turn_completed_without_tool" as const;
}

export function validateDedicatedWriteCall(call: LiveToolCall) {
  if (!call.id.trim()) return { ok: false as const, code: "write_tool_missing_id" as const };
  if (call.name !== "prepareEvidencePacket") return { ok: false as const, code: "unexpected_tool_called" as const };
  if (!call.args || Object.getPrototypeOf(call.args) !== Object.prototype || Object.keys(call.args).length !== 0) {
    return { ok: false as const, code: "write_tool_payload_invalid" as const };
  }
  return { ok: true as const };
}

export function validateCanonicalWriteAction(call: LiveToolCall, session: SemaSession): AgentAction {
  const result = validateLiveToolCall(call, session);
  if (!result.ok || result.action.type !== "prepareEvidencePacket" || result.action.riskLevel !== "write" || !result.action.requiresPermission) {
    throw Object.assign(new Error("Canonical write action was not available"), { code: "canonical_action_missing" });
  }
  return result.action;
}

export function evaluateCanonicalWritePermission(call: LiveToolCall, action: AgentAction) {
  const decision = evaluatePermission(action);
  const visibleState = liveStateReducer(initialLiveState, { type: "permission", pending: { call, action } });
  if (decision.outcome !== "permission_required" || visibleState.status !== "awaiting_confirmation") {
    throw Object.assign(new Error("Canonical permission gate did not require visible confirmation"), { code: "permission_gate_incorrect" });
  }
  return { permissionRequired: true, actionExecuted: false as const, sessionMutated: false as const };
}

export function createConfirmationRequiredResponse(call: LiveToolCall) {
  return {
    functionResponses: [{
      id: call.id,
      name: "prepareEvidencePacket",
      response: {
        ok: false,
        status: "confirmation_required",
        message: "The action has not executed. The user must confirm it on screen."
      }
    }]
  };
}

export function hasEarlyCompletionClaim(text: string) {
  return /\b(?:i|we|sema)\s+(?:have\s+)?(?:prepared|generated|completed|created)\b[^.]*\bpacket\b|\b(?:your|the)\s+(?:evidence\s+)?packet\s+(?:is|has been)\s+(?:ready|prepared|generated|completed|created)\b/i.test(text);
}

export function isConfirmationRequiredAcknowledgement(text: string) {
  return !hasEarlyCompletionClaim(text)
    && /\bconfirm(?:ation)?\b/i.test(text)
    && /\b(?:screen|on-screen)\b/i.test(text)
    && /\b(?:not|has not|hasn't|before|must|need)\b/i.test(text);
}

export function sanitizeWriteProbeEvent(record: SanitizedWriteProbeEventRecord): SanitizedWriteProbeEventRecord {
  return {
    event: record.event,
    elapsedMs: Math.max(0, Math.round(record.elapsedMs)),
    ...(record.toolName ? { toolName: record.toolName } : {}),
    ...(record.functionCallCount === undefined ? {} : { functionCallCount: record.functionCallCount }),
    ...(record.transcriptCharacterCount === undefined ? {} : { transcriptCharacterCount: record.transcriptCharacterCount })
  };
}
