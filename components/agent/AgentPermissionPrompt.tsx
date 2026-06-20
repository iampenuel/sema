"use client";

import type { AgentAction, PermissionDecision } from "@/lib/agent/agentTypes";

export function AgentPermissionPrompt({
  action,
  decision,
  onConfirm,
  onCancel
}: {
  action: AgentAction;
  decision: PermissionDecision;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-sema-blue/25 bg-sema-pale/60 p-3">
      <p className="text-sm font-semibold text-ink">{action.label}</p>
      <p className="mt-1 text-sm text-muted">{decision.message}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onConfirm} className="rounded-md bg-sema-blue px-3 py-2 text-sm font-semibold text-white hover:bg-sema-blue-dark">
          {decision.confirmLabel ?? "Continue"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-sema-border bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-sema-blue/30">
          {decision.cancelLabel ?? "Cancel"}
        </button>
      </div>
    </div>
  );
}
