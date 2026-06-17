import { AlertCircle } from "lucide-react";
import { DEMO_PRIVACY_COPY, SEMAPHASE_SAFETY_NOTE } from "@/lib/safety/safetyCopy";

export function SafetyBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-lg border border-blue/15 bg-blue/5 p-4 text-sm text-ink">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue" aria-hidden="true" />
        <div>
          <p className="font-semibold">Informational support only. Not medical advice.</p>
          <p className="mt-1 text-muted">{compact ? SEMAPHASE_SAFETY_NOTE : `${SEMAPHASE_SAFETY_NOTE} ${DEMO_PRIVACY_COPY}`}</p>
        </div>
      </div>
    </div>
  );
}
