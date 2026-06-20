"use client";

import { Mic, ShieldCheck, Trash2 } from "lucide-react";
import { VoiceCapturePanel } from "@/components/voice/VoiceCapturePanel";
import type { VoiceCaptureController } from "@/hooks/useVoiceCapture";
import type { AudioSignal, SemaSession } from "@/lib/sema-session/types";

const tags = ["voice note", "timing noted", "context noted", "sound changed", "other"];

export function AudioSignalCard({
  session,
  onAdd,
  onRemove,
  capture,
  voiceOpen,
  onOpenVoice,
  onCloseVoice,
  onSaveVoiceStory,
  onSaveVoiceAudio
}: {
  session: SemaSession;
  onAdd: (signal: AudioSignal) => void;
  onRemove: (id: string) => void;
  capture: VoiceCaptureController;
  voiceOpen: boolean;
  onOpenVoice: () => void;
  onCloseVoice: () => void;
  onSaveVoiceStory: (text: string, mode: "append" | "replace") => boolean;
  onSaveVoiceAudio: (signal: AudioSignal) => boolean;
}) {
  function confirmRemove(signal: AudioSignal) {
    if (window.confirm(`Delete "${signal.name}" from this session? This cannot be undone.`)) onRemove(signal.id);
  }

  function selectedTags(formData: FormData) {
    return tags.filter((tag) => formData.get(tag) === "on");
  }

  function saveFallback(formData: FormData) {
    onAdd({
      id: `audio-manual-${Date.now()}`,
      name: String(formData.get("fallbackName") || "Manual audio observation"),
      durationSeconds: Math.max(0, Number(formData.get("duration")) || 0),
      tags: selectedTags(formData),
      notes: String(formData.get("fallbackNotes") || "") || undefined,
      transcript: String(formData.get("fallbackTranscript") || "") || undefined,
      createdAt: new Date().toISOString(),
      source: "manual_note"
    });
  }

  return (
    <section className="rounded-lg border border-sema-border bg-white p-5 shadow-card" aria-labelledby="audio-title">
      <p className="flex items-center gap-2 text-xs font-bold text-sema-blue"><Mic className="h-4 w-4" aria-hidden="true" />Audio signal</p>
      <h2 id="audio-title" className="mt-2 text-2xl font-bold text-ink">What did you notice?</h2>
      <p className="mt-1 text-sm leading-6 text-sema-slate">Sema records patient-provided observations. It does not analyze audio for disease, diagnose, treat, or determine urgency.</p>

      {!voiceOpen ? <button type="button" onClick={onOpenVoice} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white"><Mic className="h-4 w-4" aria-hidden="true" />Record audio signal</button> : null}
      {voiceOpen ? <VoiceCapturePanel capture={capture} hasExistingStory={Boolean(session.story.rawText.trim())} onSaveStory={onSaveVoiceStory} onSaveAudio={onSaveVoiceAudio} onClose={onCloseVoice} /> : null}

      <form action={saveFallback} className="mt-5 rounded-md border border-sema-border bg-[#fbfcfd] p-4">
        <h3 className="font-semibold text-ink">Typed/manual alternative</h3>
        <p className="mt-1 text-sm text-sema-slate">Use this when recording is unavailable, denied, or simply not preferred.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="text-sm font-semibold text-ink">Observation name</span><input name="fallbackName" className="mt-1 w-full rounded-md border border-sema-border px-3 py-2 text-sm" defaultValue="Manual audio observation" /></label>
          <label className="block"><span className="text-sm font-semibold text-ink">Approximate duration in seconds</span><input name="duration" type="number" min="0" className="mt-1 w-full rounded-md border border-sema-border px-3 py-2 text-sm" defaultValue={0} /></label>
          <label className="block sm:col-span-2"><span className="text-sm font-semibold text-ink">Manual transcript or description</span><textarea name="fallbackTranscript" className="mt-1 min-h-20 w-full rounded-md border border-sema-border px-3 py-2 text-sm" /></label>
          <label className="block sm:col-span-2"><span className="text-sm font-semibold text-ink">Notes</span><textarea name="fallbackNotes" className="mt-1 min-h-20 w-full rounded-md border border-sema-border px-3 py-2 text-sm" placeholder="Describe the observation without interpreting disease." /></label>
        </div>
        <div className="mt-3"><TagGrid /></div>
        <button type="submit" className="mt-3 min-h-11 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-blue-dark">Save manual observation</button>
      </form>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">Saved audio observations</h3>
        {session.audioSignals.length === 0 ? <p className="mt-2 rounded-md border border-sema-border bg-[#fbfcfd] p-4 text-sm text-sema-slate">No audio metadata has been saved. Raw recordings are never stored in the session.</p> : (
          <ul className="mt-2 grid gap-2">
            {session.audioSignals.map((signal) => (
              <li key={signal.id} className="rounded-md border border-sema-border bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{signal.name}</p>
                    <p className="mt-1 text-sm text-sema-slate">{signal.durationSeconds}s · {new Date(signal.createdAt).toLocaleString()} · {signal.tags.join(", ") || "No tags"}</p>
                    <p className="mt-2 text-xs font-semibold text-sema-blue-dark">{signal.source === "browser_voice_capture" || signal.source === "patient_recorded" ? "Patient-recorded browser audio" : signal.source === "demo_simulated" ? "Synthetic demo metadata" : "Patient-entered manual observation"}</p>
                  </div>
                  <button type="button" onClick={() => confirmRemove(signal)} aria-label={`Remove ${signal.name}`} className="flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-clay/10 hover:text-clay"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                </div>
                {signal.transcript ? <p className="mt-3 rounded-md bg-[#f8fbfd] p-3 text-sm leading-5 text-sema-slate"><span className="font-semibold text-ink">Reviewed transcript:</span> {signal.transcript}</p> : null}
                {signal.notes ? <p className="mt-2 text-sm text-sema-slate">{signal.notes}</p> : null}
                <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-sema-green"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Observation only · Not analyzed for disease</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TagGrid() {
  return <fieldset><legend className="text-sm font-semibold text-ink">Neutral tags</legend><div className="mt-2 flex flex-wrap gap-2">{tags.map((tag) => <label key={tag} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-sema-border bg-white px-3 py-1.5 text-sm text-ink"><input name={tag} type="checkbox" className="h-4 w-4" />{tag}</label>)}</div></fieldset>;
}
