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
    <fieldset className="rounded-lg border border-sema-border bg-white/90 p-3.5 shadow-card">
      <legend className="px-1 text-sm font-semibold text-ink">Concern type</legend>
      <p className="mt-0.5 text-xs text-sema-slate">Choose the broad category for this case file.</p>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {(Object.keys(concernTypeLabels) as ConcernType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={`min-h-10 rounded-md border px-3 py-2 text-left text-sm font-semibold transition ${
              value === type ? "border-sema-blue bg-sema-blue text-white shadow-sm" : "border-sema-border bg-[#f7fbfd] text-ink hover:border-sema-blue/40 hover:bg-sema-pale"
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
