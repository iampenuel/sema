"use client";

import { CheckCircle2, Circle } from "lucide-react";
import type { SemaSession } from "@/lib/sema-session/types";
import { getSessionReadiness } from "@/lib/sema-session/selectors";

export function PacketReadinessCard({
  session,
  onPrepare
}: {
  session: SemaSession;
  onPrepare: () => void;
}) {
  const readiness = getSessionReadiness(session);

  return (
    <section className="card rounded-lg p-5" aria-labelledby="readiness-title">
      <h2 id="readiness-title" className="text-2xl font-bold text-ink">Packet readiness</h2>
      <p className="mt-1 text-sm text-muted">The packet can be prepared at any time, but completed signals make it more useful.</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {readiness.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-muted">
            {item.complete ? <CheckCircle2 className="h-4 w-4 text-sage" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
            {item.label}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onPrepare} className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90">
        Prepare packet preview
      </button>
    </section>
  );
}
