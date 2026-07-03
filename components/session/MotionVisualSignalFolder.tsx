"use client";
/* eslint-disable @next/next/no-img-element -- approved photos use current-tab blob URLs */

import { Camera, Save, ShieldCheck, Trash2 } from "lucide-react";
import { PhotoCapturePanel } from "@/components/photo/PhotoCapturePanel";
import type { EphemeralPhotoDraft, PhotoObservationMetadata } from "@/lib/photo/types";
import type { MotionVisualNote } from "@/lib/sema-session/types";

type Props = {
  notes: MotionVisualNote[];
  photos: PhotoObservationMetadata[];
  photoCaptureOpen: boolean;
  onOpenPhotoCapture: () => void;
  onClosePhotoCapture: () => void;
  onApprovePhoto: (draft: EphemeralPhotoDraft, metadata: PhotoObservationMetadata) => void;
  onUpdatePhoto: (metadata: PhotoObservationMetadata) => void;
  onRemovePhoto: (id: string) => void;
  getRuntimePhoto: (id: string) => EphemeralPhotoDraft | undefined;
  onSave: (note: string) => void;
};

export function MotionVisualSignalFolder({ notes, photos, photoCaptureOpen, onOpenPhotoCapture, onClosePhotoCapture, onApprovePhoto, onUpdatePhoto, onRemovePhoto, getRuntimePhoto, onSave }: Props) {
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
      <p className="mt-2 text-sm leading-6 text-sema-slate">Add movement or visual notes, or optionally capture a photo after Azure content-safety screening.</p>

      <div className="mt-5 rounded-md border border-sema-border bg-sema-pale/50 p-4">
        <h3 className="font-semibold text-ink">Privacy-safe photo observation</h3>
        <p className="mt-2 text-sm leading-6 text-sema-slate">Camera access starts only after you accept the Azure screening disclosure. Sema does not upload preview frames and does not medically analyze the image.</p>
        <button type="button" onClick={onOpenPhotoCapture} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-blue bg-white px-4 py-2 text-sm font-semibold text-sema-blue-dark hover:bg-sema-pale"><Camera className="h-4 w-4" aria-hidden="true" />Take a photo</button>
      </div>

      {photoCaptureOpen && <PhotoCapturePanel onApprove={onApprovePhoto} onClose={onClosePhotoCapture} />}

      {photos.length > 0 && <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">Approved photo observations</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {photos.map((photo) => {
            const runtime = getRuntimePhoto(photo.id);
            return <article key={photo.id} className="rounded-md border border-sema-border bg-white p-3">
              {runtime ? <img src={runtime.objectUrl} alt="Patient-provided photo observation" className="aspect-video w-full rounded-md bg-black object-contain" /> : <div className="flex aspect-video items-center justify-center rounded-md bg-sema-pale p-4 text-center text-sm text-sema-slate">Photo was not retained by Sema after the browser session.</div>}
              <p className="mt-3 flex items-center gap-2 text-xs font-bold text-sema-blue"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Patient-provided photo · Passed automated content screening · Not clinically analyzed</p>
              <p className="mt-2 text-sm text-sema-slate">{photo.note || "No note added."}</p>
              {photo.bodyLocation && <p className="mt-1 text-xs text-muted">Body location: {photo.bodyLocation}</p>}
              <p className="mt-1 text-xs font-semibold text-sema-blue">Photo available in this tab only</p>
              <label className="mt-3 flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={photo.includeInPacket} onChange={(event) => onUpdatePhoto({ ...photo, includeInPacket: event.target.checked })} />Include in current evidence packet</label>
              <button type="button" onClick={() => onRemovePhoto(photo.id)} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-md border border-[#d6a9a9] px-3 text-xs font-semibold text-[#9b4141]"><Trash2 className="h-4 w-4" aria-hidden="true" />Remove photo</button>
            </article>;
          })}
        </div>
      </div>}

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
