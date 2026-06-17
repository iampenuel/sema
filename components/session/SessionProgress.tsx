"use client";

import { CheckCircle2, Circle } from "lucide-react";
import type { SemaSession } from "@/lib/sema-session/types";
import { getSessionReadiness } from "@/lib/sema-session/selectors";

export function SessionProgress({ session }: { session: SemaSession }) {
  const readiness = getSessionReadiness(session);
  const complete = readiness.filter((item) => item.complete).length;

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Packet readiness</p>
          <p className="text-xs text-muted">{complete} of {readiness.length} signals ready</p>
        </div>
        <div className="rounded-full bg-sage/10 px-3 py-1 text-sm font-semibold text-sage">{Math.round((complete / readiness.length) * 100)}%</div>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {readiness.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-muted">
            {item.complete ? <CheckCircle2 className="h-4 w-4 text-sage" aria-hidden="true" /> : <Circle className="h-4 w-4 text-muted" aria-hidden="true" />}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
