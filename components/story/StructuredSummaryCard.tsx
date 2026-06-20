"use client";

import type { StructuredSummary } from "@/lib/sema-session/types";

function TextListEditor({
  label,
  values,
  onChange
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <textarea
        className="mt-1 min-h-24 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm text-ink"
        value={values.join("\n")}
        onChange={(event) => onChange(event.target.value.split("\n").filter(Boolean))}
      />
    </label>
  );
}

export function StructuredSummaryCard({
  summary,
  onChange
}: {
  summary?: StructuredSummary;
  onChange: (summary: StructuredSummary) => void;
}) {
  if (!summary) {
    return (
      <div className="rounded-md border border-sema-border bg-[#f8fbfd] p-4 text-sm text-sema-slate">
        No AI-organized summary yet. Generate one after saving patient-provided story text.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-sema-border bg-sema-pale/45 p-4">
      <div>
        <p className="text-xs font-bold text-sema-blue">AI-ORGANIZED FROM PATIENT-PROVIDED INFORMATION</p>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-ink">Main concern</span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm text-ink"
            value={summary.mainConcern}
            onChange={(event) => onChange({ ...summary, mainConcern: event.target.value })}
          />
        </label>
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">Timeline</p>
        <div className="mt-2 space-y-2">
          {summary.timeline.map((item, index) => (
            <input
              key={item.id}
              className="w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm"
              value={`${item.label}: ${item.detail}`}
              onChange={(event) => {
                const next = [...summary.timeline];
                next[index] = { ...item, detail: event.target.value };
                onChange({ ...summary, timeline: next });
              }}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextListEditor label="Affected areas" values={summary.affectedAreas} onChange={(values) => onChange({ ...summary, affectedAreas: values })} />
        <TextListEditor label="Changes over time" values={summary.changesOverTime} onChange={(values) => onChange({ ...summary, changesOverTime: values })} />
        <TextListEditor label="Triggers or patterns" values={summary.triggersOrPatterns} onChange={(values) => onChange({ ...summary, triggersOrPatterns: values })} />
        <TextListEditor label="Patient concerns" values={summary.patientConcerns} onChange={(values) => onChange({ ...summary, patientConcerns: values })} />
        <TextListEditor label="Missing details" values={summary.missingDetails} onChange={(values) => onChange({ ...summary, missingDetails: values })} />
        <TextListEditor label="Questions for clinician" values={summary.clinicianQuestions} onChange={(values) => onChange({ ...summary, clinicianQuestions: values })} />
      </div>
      <p className="rounded-lg bg-white px-3 py-2 text-xs text-muted">{summary.summaryNote}</p>
    </div>
  );
}
