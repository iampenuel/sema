"use client";

import { useState } from "react";
import { Bot, ShieldCheck, Sparkles } from "lucide-react";
import { routeAgentMessage } from "@/lib/agent/agentRouter";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import type { AgentAction, AgentMessage, PermissionDecision } from "@/lib/agent/agentTypes";
import type { SemaSession } from "@/lib/sema-session/types";
import { AgentInput } from "./AgentInput";
import { AgentMessageList } from "./AgentMessageList";
import { AgentPermissionPrompt } from "./AgentPermissionPrompt";

const starterPrompts = [
  "Summarize my session so far.",
  "What details are missing?",
  "Prepare my packet.",
  "Take me to the body map.",
  "Record an audio signal.",
  "Help me make questions for a clinician.",
  "Read the safety note."
];

export function SemaAgentPanel({
  session,
  onExecuteAction
}: {
  session: SemaSession;
  onExecuteAction: (action: AgentAction) => string;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: "agent-welcome",
      role: "agent",
      content:
        "Hi, I'm Sema. I can help organize patient-provided observations, prepare the packet after permission, and keep the safety boundary visible."
    }
  ]);
  const [pending, setPending] = useState<{ action: AgentAction; decision: PermissionDecision } | null>(null);

  function addMessage(role: AgentMessage["role"], content: string) {
    setMessages((current) => [...current, { id: `${role}-${Date.now()}-${current.length}`, role, content }]);
  }

  function handleAction(action: AgentAction) {
    const decision = evaluatePermission(action);

    if (decision.outcome === "not_required") {
      const result = onExecuteAction(action);
      addMessage("agent", result);
      return;
    }

    if (decision.outcome === "blocked_by_safety") {
      addMessage("agent", decision.message ?? "I cannot perform that action because it crosses Sema's safety boundaries.");
      return;
    }

    setPending({ action, decision });
  }

  function handleSend(message: string) {
    addMessage("user", message);
    const response = routeAgentMessage(message, { session, currentRoute: "/session" });
    addMessage("agent", response.reply);
    response.proposedActions.forEach(handleAction);
  }

  function confirmPending() {
    if (!pending) return;
    const result = onExecuteAction(pending.action);
    setPending(null);
    addMessage("agent", result);
  }

  return (
    <aside className="no-print rounded-lg border border-ink/10 bg-white/78 p-4 shadow-soft" aria-label="Sema agent panel">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-sage text-white">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-bold text-ink">Sema</h2>
          <p className="text-xs text-muted">Signal-capture co-pilot</p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-sage/20 bg-sage/5 p-3 text-sm text-ink">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-sage" aria-hidden="true" />
          Safety status
        </p>
        <p className="mt-1 text-muted">Not a diagnosis, treatment, or triage tool.</p>
      </div>

      <div className="mt-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-clay" aria-hidden="true" />
          Starter prompts
        </p>
        <div className="flex flex-wrap gap-2">
          {starterPrompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => handleSend(prompt)} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sage/40">
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 max-h-[360px] overflow-y-auto rounded-lg bg-ink/5 p-3">
        <AgentMessageList messages={messages} />
      </div>

      {pending ? (
        <div className="mt-4">
          <AgentPermissionPrompt
            action={pending.action}
            decision={pending.decision}
            onConfirm={confirmPending}
            onCancel={() => {
              setPending(null);
              addMessage("agent", "Cancelled.");
            }}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <AgentInput onSend={handleSend} />
      </div>
    </aside>
  );
}
