"use client";

import { MapPinned, Trash2 } from "lucide-react";
import type { BodyMapObservation, SemaSession } from "@/lib/sema-session/types";
import { signalTypeLabels } from "@/lib/sema-session/types";

const regions = ["Right wrist / hand", "Left wrist / hand", "Right arm", "Left arm", "Right leg", "Left leg", "Chest / breathing", "Skin area", "Other"];

export function BodyMapSignalCard({
  session,
  onAdd,
  onRemove
}: {
  session: SemaSession;
  onAdd: (observation: BodyMapObservation) => void;
  onRemove: (id: string) => void;
}) {
  function handleSubmit(formData: FormData) {
    const regionLabel = String(formData.get("regionLabel") || "");
    const signalType = String(formData.get("signalType") || "pain") as BodyMapObservation["signalType"];
    const note = String(formData.get("note") || "");
    const intensityValue = Number(formData.get("intensity"));

    if (!regionLabel) return;

    onAdd({
      id: `body-${Date.now()}`,
      regionLabel,
      signalType,
      note,
      intensity: Number.isFinite(intensityValue) ? intensityValue : undefined,
      source: "patient_stated"
    });
  }

  return (
    <section className="rounded-lg border border-sema-border bg-white p-5 shadow-card" aria-labelledby="body-title">
      <p className="flex items-center gap-2 text-xs font-bold text-sema-blue">
        <MapPinned className="h-4 w-4" aria-hidden="true" />
        Body/location signal
      </p>
      <h2 id="body-title" className="mt-2 text-2xl font-bold text-ink">Where did you notice it?</h2>
      <p className="mt-1 text-sm leading-6 text-sema-slate">Mark where you noticed a symptom or limitation. These are patient-reported location notes, not a diagnosis.</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-sema-border bg-gradient-to-b from-white to-sema-pale/60 p-5">
          <div className="mx-auto flex h-64 max-w-56 flex-col items-center justify-center gap-2 text-center">
            <div className="h-20 w-16 rounded-full border-2 border-sema-blue/35 bg-white" aria-hidden="true" />
            <div className="h-28 w-20 rounded-[32px] border-2 border-sema-blue/35 bg-white" aria-hidden="true" />
            <div className="grid w-48 grid-cols-2 gap-3" aria-hidden="true">
              <div className="h-20 rounded-full border-2 border-sema-blue/35 bg-white" />
              <div className="h-20 rounded-full border-2 border-sema-blue/35 bg-white" />
            </div>
          </div>
          <p className="text-center text-xs text-muted">Simplified visual placeholder. Use the form to record patient-stated location notes.</p>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-ink">Region</span>
            <select name="regionLabel" className="mt-1 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm" defaultValue="Right wrist / hand">
              {regions.map((region) => (
                <option key={region}>{region}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Signal type</span>
            <select name="signalType" className="mt-1 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm" defaultValue="pain">
              {(Object.keys(signalTypeLabels) as BodyMapObservation["signalType"][]).map((signal) => (
                <option key={signal} value={signal}>{signalTypeLabels[signal]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Intensity, optional</span>
            <input name="intensity" type="range" min="0" max="10" defaultValue="5" className="mt-2 w-full" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Note, optional</span>
            <textarea name="note" className="mt-1 min-h-20 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm" placeholder="Patient-stated note, such as movement limitation or when it happens." />
          </label>
          <button type="submit" className="rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white hover:bg-sema-blue-dark">Save observation</button>
        </form>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">Saved observations</h3>
        {session.bodyLocation.length === 0 ? (
          <p className="mt-2 rounded-md border border-sema-border bg-[#f8fbfd] p-4 text-sm text-sema-slate">Add a marker to show where you noticed a symptom or limitation.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {session.bodyLocation.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-sema-border bg-white p-3 text-sm">
                <div>
                  <p className="font-semibold text-ink">{item.regionLabel} · {signalTypeLabels[item.signalType]}</p>
                  <p className="text-muted">{item.note || "No note added."}{typeof item.intensity === "number" ? ` Intensity: ${item.intensity}/10.` : ""}</p>
                </div>
                <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.regionLabel}`} className="rounded-lg p-2 text-muted hover:bg-clay/10 hover:text-clay">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
