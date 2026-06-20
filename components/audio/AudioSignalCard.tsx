"use client";

import { Mic, Square, Trash2, Waves } from "lucide-react";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import type { AudioSignal, SemaSession } from "@/lib/sema-session/types";

const tags = ["dry", "wet", "painful", "worse at night", "after exercise", "comes and goes", "other"];
const demoPeaks = [18, 34, 22, 48, 37, 56, 28, 42, 20, 46, 31, 52];

export function AudioSignalCard({
  session,
  onAdd,
  onRemove
}: {
  session: SemaSession;
  onAdd: (signal: AudioSignal) => void;
  onRemove: (id: string) => void;
}) {
  const recorder = useAudioRecorder();

  function confirmRemove(signal: AudioSignal) {
    const confirmed = window.confirm(`Delete "${signal.name}" from this session? This cannot be undone.`);
    if (confirmed) onRemove(signal.id);
  }

  function selectedTags(formData: FormData) {
    return tags.filter((tag) => formData.get(tag) === "on");
  }

  function saveRecorded(formData: FormData) {
    onAdd({
      id: `audio-${Date.now()}`,
      name: String(formData.get("name") || "Recorded audio signal"),
      durationSeconds: recorder.durationSeconds,
      objectUrl: recorder.audioUrl,
      tags: selectedTags(formData),
      notes: String(formData.get("notes") || ""),
      waveformPeaks: demoPeaks,
      createdAt: new Date().toISOString(),
      source: "patient_recorded"
    });
    recorder.reset();
  }

  function saveFallback(formData: FormData) {
    onAdd({
      id: `audio-demo-${Date.now()}`,
      name: String(formData.get("fallbackName") || "Manual audio note"),
      durationSeconds: Number(formData.get("duration")) || 15,
      tags: selectedTags(formData),
      notes: String(formData.get("fallbackNotes") || ""),
      waveformPeaks: demoPeaks,
      createdAt: new Date().toISOString(),
      source: "demo_simulated"
    });
  }

  return (
    <section className="rounded-lg border border-sema-border bg-white p-5 shadow-card" aria-labelledby="audio-title">
      <p className="flex items-center gap-2 text-xs font-bold text-sema-blue">
        <Mic className="h-4 w-4" aria-hidden="true" />
        Audio signal
      </p>
      <h2 id="audio-title" className="mt-2 text-2xl font-bold text-ink">What did it sound or feel like?</h2>
      <p className="mt-1 text-sm leading-6 text-sema-slate">Sema does not classify audio or identify diseases from recordings. Audio is included only as a patient-generated observation.</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-md border border-sema-border bg-[#f8fbfd] p-4">
          <h3 className="font-semibold text-ink">Browser recorder</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={recorder.start} disabled={recorder.isRecording} className="inline-flex items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-muted">
              <Mic className="h-4 w-4" aria-hidden="true" />
              Record
            </button>
            <button type="button" onClick={recorder.stop} disabled={!recorder.isRecording} className="inline-flex items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-muted">
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop
            </button>
          </div>
          {recorder.error ? <p className="mt-3 rounded-lg bg-clay/10 p-3 text-sm text-clay">{recorder.error}</p> : null}
          {recorder.audioUrl ? (
            <form action={saveRecorded} className="mt-4 space-y-3">
              <audio src={recorder.audioUrl} controls aria-label="Recorded audio playback" className="w-full" />
              <p className="text-sm text-muted">Duration: {recorder.durationSeconds} seconds</p>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Name</span>
                <input name="name" className="mt-1 w-full rounded-md border border-sema-border px-3 py-2 text-sm" defaultValue="Recorded audio signal" />
              </label>
              <TagGrid />
              <label className="block">
                <span className="text-sm font-semibold text-ink">Notes</span>
                <textarea name="notes" className="mt-1 min-h-20 w-full rounded-md border border-sema-border px-3 py-2 text-sm" />
              </label>
              <button type="submit" className="rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white">Save recording</button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-muted">No recording saved yet.</p>
          )}
        </div>

        <form action={saveFallback} className="rounded-md border border-sema-border bg-[#f8fbfd] p-4">
          <h3 className="font-semibold text-ink">Demo/manual fallback</h3>
          <p className="mt-1 text-sm text-muted">Use this if recording is unsupported, denied, or not appropriate for the demo.</p>
          <label className="mt-4 block">
            <span className="text-sm font-semibold text-ink">Signal name</span>
            <input name="fallbackName" className="mt-1 w-full rounded-md border border-sema-border px-3 py-2 text-sm" defaultValue="Manual audio note" />
          </label>
          <label className="mt-3 block">
            <span className="text-sm font-semibold text-ink">Duration in seconds</span>
            <input name="duration" type="number" min="1" className="mt-1 w-full rounded-md border border-sema-border px-3 py-2 text-sm" defaultValue={18} />
          </label>
          <div className="mt-3">
            <TagGrid />
          </div>
          <label className="mt-3 block">
            <span className="text-sm font-semibold text-ink">Notes</span>
            <textarea name="fallbackNotes" className="mt-1 min-h-20 w-full rounded-md border border-sema-border px-3 py-2 text-sm" placeholder="Describe the patient-generated audio observation without interpreting disease." />
          </label>
          <button type="submit" className="mt-3 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white">Save audio note</button>
        </form>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">Saved audio observations</h3>
        {session.audioSignals.length === 0 ? (
          <p className="mt-2 rounded-md border border-sema-border bg-[#f8fbfd] p-4 text-sm text-sema-slate">Record or simulate an audio signal. Sema will not classify the sound or identify disease.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {session.audioSignals.map((signal) => (
              <li key={signal.id} className="rounded-md border border-sema-border bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{signal.name}</p>
                    <p className="text-sm text-muted">{signal.durationSeconds}s · {signal.source === "patient_recorded" ? "Patient recorded" : "Demo/manual"} · {signal.tags.join(", ") || "No tags"}</p>
                  </div>
                  <button type="button" onClick={() => confirmRemove(signal)} aria-label={`Remove ${signal.name}`} className="rounded-md p-2 text-muted hover:bg-clay/10 hover:text-clay">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <Waveform peaks={signal.waveformPeaks ?? demoPeaks} />
                {signal.objectUrl ? <audio src={signal.objectUrl} controls aria-label={`Playback for ${signal.name}`} className="mt-2 w-full" /> : null}
                {signal.notes ? <p className="mt-2 text-sm text-muted">{signal.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TagGrid() {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">Tags</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <label key={tag} className="inline-flex items-center gap-2 rounded-full border border-sema-border bg-white px-3 py-1.5 text-sm text-ink">
            <input name={tag} type="checkbox" className="h-4 w-4" />
            {tag}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Waveform({ peaks }: { peaks: number[] }) {
  return (
    <div className="mt-3 flex h-12 items-center gap-1" aria-label="Decorative waveform preview">
      <Waves className="mr-2 h-4 w-4 text-sema-blue" aria-hidden="true" />
      {peaks.map((peak, index) => (
        <span key={`${peak}-${index}`} className="w-2 rounded-full bg-sema-blue/60" style={{ height: `${Math.max(10, peak)}%` }} />
      ))}
    </div>
  );
}
