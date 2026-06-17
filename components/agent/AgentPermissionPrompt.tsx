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
    <div className="rounded-lg border border-blue/20 bg-blue/5 p-3">
      <p className="text-sm font-semibold text-ink">{action.label}</p>
      <p className="mt-1 text-sm text-muted">{decision.message}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onConfirm} className="rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-ink/90">
          {decision.confirmLabel ?? "Continue"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-clay/30">
          {decision.cancelLabel ?? "Cancel"}
        </button>
      </div>
    </div>
  );
}
