"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Sparkles } from "lucide-react";
import type { SemaSession } from "@/lib/sema-session/types";
import type { SignalFolderId } from "@/lib/sema-session/types";
import { getPacketReadinessDecision, getSessionReadiness, packetNotReadyMessage } from "@/lib/sema-session/selectors";

export function PacketReadinessCard({
  session,
  onPrepare,
  onNavigate
}: {
  session: SemaSession;
  onPrepare: () => boolean;
  onNavigate?: (folder: SignalFolderId) => void;
}) {
  const readiness = getSessionReadiness(session);
  const decision = getPacketReadinessDecision(session);
  const [notice, setNotice] = useState("");
  const next = decision.unresolvedRequirements[0];

  function handlePrepare() {
    if (!decision.ready) {
      setNotice(packetNotReadyMessage(decision));
      return;
    }
    if (!onPrepare()) {
      setNotice("Review the organized story summary before preparing the packet.");
      return;
    }
    setNotice("");
  }

  return (
    <section className="rounded-lg border border-sema-border bg-white/95 p-4 shadow-card" aria-labelledby="readiness-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold text-sema-blue">PACKET ASSEMBLY</p>
          <h2 id="readiness-title" className="mt-1 font-editorial text-2xl font-semibold text-ink">Packet Readiness</h2>
          <p className="mt-1 text-sm text-sema-slate">Resolve each required folder with saved evidence or an explicit Not applicable selection before packet preparation.</p>
        </div>
        {next && <p className="shrink-0 rounded-md bg-sema-pale px-3 py-2 text-xs font-semibold text-sema-blue-dark">Next required: {next.label}</p>}
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {readiness.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-md border border-sema-border bg-[#f8fbfd] px-3 py-2 text-sm text-sema-slate">
            {item.complete ? <CheckCircle2 className="h-4 w-4 shrink-0 text-sema-green" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0 text-[#8ba1b2]" aria-hidden="true" />}
            {item.label}{"optional" in item && item.optional ? " (optional)" : ""}
          </li>
        ))}
      </ul>
      {notice && <p className="mt-4 rounded-md border border-[#e5d4b8] bg-[#fff9ef] p-3 text-sm text-[#765624]">{notice}</p>}
      {next?.recommendedAction && decision.nextRequiredDestination && decision.nextRequiredDestination !== "review_board" ? (
        <button type="button" onClick={() => onNavigate?.(decision.nextRequiredDestination as SignalFolderId)} className="mt-3 mr-2 inline-flex min-h-10 items-center rounded-md border border-sema-blue bg-white px-4 py-2 text-sm font-semibold text-sema-blue">
          Open next requirement
        </button>
      ) : null}
      <button type="button" onClick={handlePrepare} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sema-blue-dark">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Prepare packet preview
      </button>
    </section>
  );
}
