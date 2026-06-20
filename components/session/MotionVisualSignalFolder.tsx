"use client";

import { Camera, Save } from "lucide-react";
import type { MotionVisualNote } from "@/lib/sema-session/types";

export function MotionVisualSignalFolder({ notes, onSave }: { notes: MotionVisualNote[]; onSave: (note: string) => void }) {
  function handleSubmit(formData: FormData) {
    const note = String(formData.get("motionNote") || "").trim();
    if (note) onSave(note);
  }

  return (
    <section className="rounded-lg border border-sema-border bg-white p-5 shadow-card" aria-labelledby="motion-title">
      <p className="flex items-center gap-2 text-xs font-bold text-sema-blue">
        <Camera className="h-4 w-4" aria-hidden="true" />
        OPTIONAL SIGNAL
      </p>
      <h2 id="motion-title" className="mt-2 text-2xl font-bold text-ink">Motion/Visual Signal Folder</h2>
      <p className="mt-2 text-sm leading-6 text-sema-slate">Add movement or visual notes. Camera-based motion capture is planned for a later version.</p>

      <div className="mt-5 rounded-md border border-sema-border bg-sema-pale/50 p-4">
        <h3 className="font-semibold text-ink">Future motion observation card</h3>
        <p className="mt-2 text-sm leading-6 text-sema-slate">Phase 1 does not use camera tracking, heat sensing, X-ray-like claims, diagnostic overlays, or Grad-CAM-style visualization.</p>
      </div>

      <form action={handleSubmit} className="mt-5">
        <label htmlFor="motion-note" className="text-sm font-semibold text-ink">Movement or visual note</label>
        <textarea id="motion-note" name="motionNote" className="mt-2 min-h-28 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm text-ink" placeholder="Describe what you noticed without interpreting a condition." />
        <button type="submit" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white hover:bg-sema-blue-dark">
          <Save className="h-4 w-4" aria-hidden="true" />
          Save visual/motion note
        </button>
      </form>

      {notes.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">Saved notes</h3>
          <ul className="mt-2 space-y-2">
            {notes.map((note) => <li key={note.id} className="rounded-md border border-sema-border bg-[#f8fbfd] p-3 text-sm text-sema-slate">{note.note}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
