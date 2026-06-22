"use client";

import { useState } from "react";
import Image from "next/image";
import { CircleCheck, Keyboard, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { AIFallbackNotice } from "@/components/ai/AIFallbackNotice";
import { AIStatusBadge } from "@/components/ai/AIStatusBadge";
import { buildAgentContext } from "@/lib/agent/buildAgentContext";
import { routeLocalIntent, routeLocalVoiceIntent } from "@/lib/agent/localIntentRouter";
import { requestAgentProposal } from "@/lib/ai/client";
import { routeExactAgentIntent } from "@/lib/ai/localAgentIntent";
import { validateAgentProposal } from "@/lib/ai/validators/validateAgentProposal";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import { detectUnsafeRequest, getSafeRedirect } from "@/lib/safety/safetyRules";
import type { AgentAction, AgentMessage, PermissionDecision } from "@/lib/agent/agentTypes";
import type { SafetyFlag, SemaSession } from "@/lib/sema-session/types";
import { AgentInput } from "./AgentInput";
import { AgentMessageList } from "./AgentMessageList";
import { AgentPermissionPrompt } from "./AgentPermissionPrompt";
import { LiveAgentControls } from "@/components/live/LiveAgentControls";
import type { SemaLiveController } from "@/hooks/useSemaLiveSession";
import { LIVE_INTRODUCTION } from "@/lib/live/liveIntroduction";

const starterPrompts = [
  "Show me all folders.",
  "Open the Story folder.",
  "Summarize my session so far.",
  "What details are missing?",
  "Prepare my packet.",
  "Record an audio signal.",
  "Help me make questions for a clinician.",
  "Read the safety note."
];

export function SemaAgentPanel({
  session,
  onExecuteAction,
  onSafetyFlags,
  live,
  rail = false
}: {
  session: SemaSession;
  onExecuteAction: (action: AgentAction) => Promise<string>;
  onSafetyFlags?: (flags: SafetyFlag[]) => void;
  live?: SemaLiveController;
  rail?: boolean;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pending, setPending] = useState<{ action: AgentAction; decision: PermissionDecision } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [requestFailed, setRequestFailed] = useState(false);

  function addMessage(role: AgentMessage["role"], content: string) {
    setMessages((current) => [...current, { id: `${role}-${Date.now()}-${current.length}`, role, content }]);
  }

  async function handleAction(action: AgentAction) {
    const decision = evaluatePermission(action);

    if (decision.outcome === "not_required") {
      const result = await onExecuteAction(action);
      addMessage("agent", result);
      return;
    }

    if (decision.outcome === "blocked_by_safety") {
      addMessage("agent", decision.message ?? "I cannot perform that action because it crosses Sema's safety boundaries.");
      return;
    }

    setPending({ action, decision });
  }

  async function handleSend(message: string) {
    addMessage("user", message);
    const safetyFlags = detectUnsafeRequest(message);
    if (safetyFlags.length) {
      addMessage("agent", getSafeRedirect(safetyFlags));
      onSafetyFlags?.(safetyFlags);
      return;
    }

    const context = buildAgentContext(session, "/session");
    const voiceIntent = routeLocalVoiceIntent(message);
    if (voiceIntent) {
      addMessage("agent", voiceIntent.reply);
      for (const action of voiceIntent.proposedActions) await handleAction(action);
      return;
    }
    const exact = routeExactAgentIntent(message, context);
    if (exact) {
      const validated = validateAgentProposal(exact);
      addMessage("agent", exact.reply);
      for (const action of validated.actions) await handleAction(action);
      return;
    }

    setThinking(true);
    setFallbackNotice(null);
    try {
      const response = await requestAgentProposal({ message, context });
      addMessage("agent", response.reply);
      if (response.safetyFlags.length) onSafetyFlags?.(response.safetyFlags);
      for (const action of response.proposedActions) await handleAction(action);
      setFallbackNotice(response.fallbackNotice ?? null);
      setRequestFailed(Boolean(response.fallbackNotice));
    } catch {
      const response = routeLocalIntent(message, session, "/session");
      addMessage("agent", response.reply);
      if (response.safetyFlags.length) onSafetyFlags?.(response.safetyFlags);
      for (const action of response.proposedActions) await handleAction(action);
      setFallbackNotice("AI enhancement is unavailable right now. Sema is continuing in local mode, and your saved session data is still available.");
      setRequestFailed(true);
    } finally {
      setThinking(false);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    const action = pending.action;
    setPending(null);
    const result = await onExecuteAction(action);
    addMessage("agent", result);
  }

  return (
    <aside className={`no-print rounded-lg border border-sema-border bg-white/95 p-4 shadow-card ${rail ? "max-h-[calc(100vh-6rem)] overflow-y-auto" : ""}`} aria-label="Sema agent panel">
      <div className="text-center">
        <Image src="/images/sema-agent.png" alt="Sema agent" width={326} height={366} sizes="92px" className="mx-auto h-auto w-[92px]" priority />
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-sema-green" aria-hidden="true" />
          <h2 className="font-editorial text-2xl font-semibold text-ink">Sema</h2>
        </div>
        <p className="text-xs font-medium text-sema-slate">Signal-capture co-pilot</p>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Session status">
        <StatusChip icon={CircleCheck} label="Session ready" />
        <StatusChip icon={Keyboard} label="Text enabled" />
        <StatusChip icon={ShieldCheck} label="Not a diagnosis" />
        <AIStatusBadge requestFailed={requestFailed} />
      </div>

      {live ? <LiveAgentControls live={live} /> : null}

      <div className="mt-3 rounded-md border border-[#bdd5e5] bg-sema-pale/75 p-3 text-sm text-ink">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-sema-green" aria-hidden="true" />
          Informational support only
        </p>
        <p className="mt-1 text-xs leading-5 text-sema-slate">For this public demo, do not enter real sensitive medical information. Sema is a prototype for organizing patient-generated observations and does not provide medical advice.</p>
      </div>

      <div className="mt-3 rounded-md border border-sema-border bg-white p-3 text-sm leading-5 text-sema-slate shadow-sm">
        <p className="text-[10px] font-bold text-sema-blue">SEMA</p>
        <p className="mt-1">{LIVE_INTRODUCTION}</p>
      </div>

      <div className="mt-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-sema-blue" aria-hidden="true" />
          Starter prompts
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {starterPrompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => handleSend(prompt)} className="min-h-10 rounded-md border border-sema-border bg-[#f8fbfd] px-2.5 py-2 text-left text-[11px] font-semibold leading-4 text-ink transition duration-200 hover:border-sema-blue/50 hover:bg-sema-pale">
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {messages.length > 0 ? (
        <div className="mt-3 max-h-[220px] overflow-y-auto rounded-md bg-[#f1f7fb] p-2.5">
          <AgentMessageList messages={messages} />
        </div>
      ) : null}

      {thinking ? <p className="mt-3 flex items-center gap-2 text-xs font-medium text-sema-slate"><Loader2 className="h-3.5 w-3.5 animate-spin text-sema-blue" aria-hidden="true" />Sema is thinking...</p> : null}
      {fallbackNotice ? <div className="mt-3"><AIFallbackNotice message={fallbackNotice} /></div> : null}

      {pending ? (
        <div className="mt-4">
          <AgentPermissionPrompt
            action={pending.action}
            decision={pending.decision}
            onConfirm={() => { void confirmPending(); }}
            onCancel={() => {
              setPending(null);
              addMessage("agent", "Cancelled.");
            }}
          />
        </div>
      ) : null}

      <div className="mt-3 border-t border-sema-border pt-3">
        <p className="mb-2 text-[10px] font-bold text-sema-blue">TEXT INTERACTION</p>
        <AgentInput onSend={handleSend} disabled={thinking} />
      </div>
    </aside>
  );
}

function StatusChip({ icon: Icon, label }: { icon: typeof CircleCheck; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sema-border bg-[#f5f9fc] px-2 py-1 text-[10px] font-semibold text-sema-slate">
      <Icon className="h-3 w-3 text-sema-blue" aria-hidden="true" />
      {label}
    </span>
  );
}
