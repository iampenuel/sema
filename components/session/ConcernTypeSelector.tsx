"use client";

import type { ConcernType } from "@/lib/sema-session/types";
import { concernTypeLabels } from "@/lib/sema-session/types";

export function ConcernTypeSelector({
  value,
  onChange
}: {
  value?: ConcernType;
  onChange: (value: ConcernType) => void;
}) {
  return (
    <fieldset className="card rounded-lg p-5">
      <legend className="text-lg font-semibold text-ink">Concern type</legend>
      <p className="mt-1 text-sm text-muted">Choose the broad category. Phase 1 prioritizes pain/injury.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(concernTypeLabels) as ConcernType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={`rounded-lg border px-3 py-3 text-left text-sm font-semibold transition ${
              value === type ? "border-sage bg-sage text-white" : "border-ink/10 bg-white text-ink hover:border-sage/40"
            }`}
            aria-pressed={value === type}
          >
            {concernTypeLabels[type]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
