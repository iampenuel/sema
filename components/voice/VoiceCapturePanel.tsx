"use client";

import { useState } from "react";
import { CircleStop, Mic, Pause, Play, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import type { VoiceCaptureController } from "@/hooks/useVoiceCapture";
import type { AudioSignal } from "@/lib/sema-session/types";

const neutralTags = ["voice note", "timing noted", "context noted", "sound changed", "other"];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceCapturePanel({
  capture,
  hasExistingStory,
  onSaveStory,
  onSaveAudio,
  onClose
}: {
  capture: VoiceCaptureController;
  hasExistingStory: boolean;
  onSaveStory: (text: string, mode: "append" | "replace") => boolean;
  onSaveAudio: (signal: AudioSignal) => boolean;
  onClose: () => void;
}) {
  const { state, support } = capture;
  const [name, setName] = useState("Patient-recorded browser audio");
  const [notes, setNotes] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [storyMode, setStoryMode] = useState<"append" | "replace">("append");
  const [reviewedFingerprint, setReviewedFingerprint] = useState("");
  const draftFingerprint = `${state.audioObjectUrl ?? ""}:${state.transcriptDraft}`;
  const reviewConfirmed = Boolean(draftFingerprint) && reviewedFingerprint === draftFingerprint;

  function toggleTag(tag: string) {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  function discardDraft() {
    const hasDraft = Boolean(state.audioBlob || state.transcriptDraft.trim() || state.elapsedSeconds);
    if (hasDraft && !window.confirm("Delete this unsaved voice draft? Nothing from it will be added to the session.")) return;
    capture.cancel();
    onClose();
  }

  function saveDraft() {
    if (!reviewConfirmed) return;
    capture.markSaving();
    let saved = false;
    if (state.targetFolder === "story") {
      const transcript = state.transcriptDraft.trim();
      if (!transcript) {
        capture.setTranscript("");
        return;
      }
      saved = onSaveStory(transcript, storyMode);
    } else {
      saved = onSaveAudio({
        id: state.recordingId ?? `audio-${Date.now()}`,
        name: name.trim() || "Patient-recorded browser audio",
        durationSeconds: state.elapsedSeconds,
        mimeType: state.mimeType,
        tags: selectedTags,
        notes: notes.trim() || undefined,
        transcript: includeTranscript ? state.transcriptDraft.trim() || undefined : undefined,
        transcriptSource: includeTranscript && state.transcriptDraft.trim() ? "browser_transcribed_user_reviewed" : undefined,
        createdAt: new Date().toISOString(),
        source: "browser_voice_capture"
      });
    }
    if (saved) {
      capture.markSaved();
      window.setTimeout(() => {
        capture.reset();
        onClose();
      }, 300);
    } else {
      capture.returnToReview();
    }
  }

  const isCapturing = state.status === "recording" || state.status === "paused" || state.status === "stopping";
  const isReviewing = state.status === "reviewing" || state.status === "saving";

  return (
    <section className="mt-4 rounded-lg border border-[#bfd5e5] bg-[#f8fbfd] p-4 sm:p-5" aria-labelledby="voice-capture-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase text-sema-blue">
            <Mic className="h-4 w-4" aria-hidden="true" /> Browser-local voice capture
          </p>
          <h3 id="voice-capture-title" className="mt-1 text-lg font-bold text-ink">Record, review, then choose what to save</h3>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-sema-slate">Sema needs microphone access only to record this browser-local audio signal. Nothing is uploaded during this phase.</p>
        </div>
        <button type="button" onClick={discardDraft} className="min-h-10 rounded-md border border-sema-border bg-white px-3 text-sm font-semibold text-sema-slate">Close</button>
      </div>

      <div className="mt-4 rounded-md border border-[#d9e5ec] bg-white px-3 py-3 text-sm leading-5 text-sema-slate">
        <p className="font-semibold text-ink">For this public demo, do not record or enter real sensitive medical information.</p>
        <p>Audio and notes are for demonstration only. Sema does not analyze audio for disease, diagnose, treat, or determine urgency.</p>
      </div>

      <div className="sr-only" aria-live="polite">
        {state.status === "requesting_permission" ? "Requesting microphone permission." : null}
        {state.status === "recording" ? "Recording started. Sema is listening." : null}
        {state.status === "reviewing" ? "Recording stopped. Draft ready for review." : null}
        {state.errorMessage ?? ""}
      </div>

      {(state.status === "idle" || state.status === "cancelled") && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={state.permission === "granted" ? capture.start : capture.requestPermission} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white">
            <Mic className="h-4 w-4" aria-hidden="true" /> {state.permission === "granted" ? "Start recording" : "Allow microphone"}
          </button>
          <p className="text-sm text-sema-slate">{state.permission === "granted" ? "The previous draft was cancelled. Start again when ready." : "Access begins only after you choose Allow in your browser."}</p>
        </div>
      )}

      {state.status === "requesting_permission" && <p className="mt-4 text-sm font-semibold text-sema-blue-dark">Waiting for your browser permission choice...</p>}

      {state.status === "ready" && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={capture.start} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white">
            <Mic className="h-4 w-4" aria-hidden="true" /> Start recording
          </button>
          <p className="text-sm text-sema-slate">Maximum public-demo recording: 3 minutes.</p>
        </div>
      )}

      {(state.status === "permission_denied" || state.status === "permission_unavailable" || state.status === "error") && (
        <div className="mt-4 rounded-md border border-[#e3c9c9] bg-white p-3 text-sm text-[#8b4141]">
          <p className="font-semibold">{state.errorMessage ?? "Browser recording is unavailable."}</p>
          <p className="mt-1 text-sema-slate">You can keep using the typed story or manual audio notes. Sema will not repeatedly prompt for access.</p>
        </div>
      )}

      {isCapturing && (
        <div className="mt-4 rounded-md border border-[#b9d4e5] bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-bold text-ink"><span className="h-2.5 w-2.5 rounded-full bg-[#b94a4a]" aria-hidden="true" />{state.status === "paused" ? "Recording paused" : "Sema is listening"}</p>
              <p className="mt-1 font-mono text-lg text-sema-blue-dark" aria-label={`Elapsed recording time ${formatDuration(state.elapsedSeconds)}`}>{formatDuration(state.elapsedSeconds)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {support.pauseResume && state.status === "recording" ? <button type="button" onClick={capture.pause} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-ink"><Pause className="h-4 w-4" aria-hidden="true" />Pause</button> : null}
              {support.pauseResume && state.status === "paused" ? <button type="button" onClick={capture.resume} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-ink"><Play className="h-4 w-4" aria-hidden="true" />Resume</button> : null}
              <button type="button" onClick={() => capture.stop()} disabled={state.status === "stopping"} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white disabled:bg-muted"><CircleStop className="h-4 w-4" aria-hidden="true" />Stop and review</button>
              <button type="button" onClick={discardDraft} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#dfc4c4] bg-white px-4 py-2 text-sm font-semibold text-[#8b4141]"><Trash2 className="h-4 w-4" aria-hidden="true" />Cancel</button>
            </div>
          </div>
          {state.transcriptSupported ? <p className="mt-3 text-sm text-sema-slate">Draft transcription is active when your browser permits it. Interim text: {state.interimTranscript || "Listening..."}</p> : <p className="mt-3 text-sm text-sema-slate">Draft transcription is unavailable in this browser. Recording still works, and you can type notes during review.</p>}
        </div>
      )}

      {isReviewing && (
        <div className="mt-4 space-y-4">
          {state.limitReached ? <p className="rounded-md border border-[#d8c893] bg-[#fffdf3] p-3 text-sm text-[#75621f]">The 3-minute public-demo limit was reached. Your captured draft is ready to review.</p> : null}
          {state.audioObjectUrl ? <audio controls src={state.audioObjectUrl} className="w-full" aria-label="Local playback of unsaved voice draft" /> : null}
          <p className="text-sm text-sema-slate">Duration: {formatDuration(state.elapsedSeconds)} · Audio remains in this browser and is available only while you review this draft.</p>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Draft captured from voice — review required</span>
            <textarea value={state.transcriptDraft} onChange={(event) => capture.setTranscript(event.target.value)} className="mt-2 min-h-32 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm leading-6 text-ink" placeholder="Browser transcription may appear here. You can always type or correct the notes yourself." />
            <span className="mt-1 block text-xs leading-5 text-sema-slate">Speech recognition can make mistakes. Read and edit this draft before saving. Draft transcription depends on browser support.</span>
          </label>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">Save reviewed content to</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["story", "audio"] as const).map((target) => <label key={target} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-3 py-2 text-sm text-ink"><input type="radio" checked={state.targetFolder === target} onChange={() => capture.setTarget(target)} />{target === "story" ? "Story Signal Folder" : "Audio Signal Folder"}</label>)}
            </div>
          </fieldset>

          {state.targetFolder === "story" ? (
            hasExistingStory ? <fieldset><legend className="text-sm font-semibold text-ink">Existing story content</legend><div className="mt-2 flex flex-wrap gap-2"><label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-3 py-2 text-sm"><input type="radio" checked={storyMode === "append"} onChange={() => setStoryMode("append")} />Append to story</label><label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-3 py-2 text-sm"><input type="radio" checked={storyMode === "replace"} onChange={() => setStoryMode("replace")} />Replace story</label></div></fieldset> : null
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="text-sm font-semibold text-ink">Recording name</span><input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm" /></label>
              <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold text-ink">Neutral tags</legend><div className="mt-2 flex flex-wrap gap-2">{neutralTags.map((tag) => <label key={tag} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-sema-border bg-white px-3 py-1.5 text-sm"><input type="checkbox" checked={selectedTags.includes(tag)} onChange={() => toggleTag(tag)} />{tag}</label>)}</div></fieldset>
              <label className="block sm:col-span-2"><span className="text-sm font-semibold text-ink">Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm" placeholder="Describe the observation without interpreting disease." /></label>
              <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={includeTranscript} onChange={(event) => setIncludeTranscript(event.target.checked)} />Include the reviewed transcript with this audio observation</label>
            </div>
          )}

          <label className="flex min-h-11 items-start gap-3 rounded-md border border-[#c8ddd7] bg-[#f5faf8] p-3 text-sm font-semibold text-ink">
            <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewedFingerprint(event.target.checked ? draftFingerprint : "")} className="mt-0.5 h-4 w-4" />
            <span><ShieldCheck className="mr-1 inline h-4 w-4 text-sema-green" aria-hidden="true" />I reviewed this transcript and corrected anything that was inaccurate.</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveDraft} disabled={!reviewConfirmed || (state.targetFolder === "story" && !state.transcriptDraft.trim()) || state.status === "saving"} className="min-h-11 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-muted">{state.targetFolder === "story" ? "Save to Story" : "Save to Audio Signal"}</button>
            <button type="button" onClick={capture.reset} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-ink"><RotateCcw className="h-4 w-4" aria-hidden="true" />Record again</button>
            <button type="button" onClick={discardDraft} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#dfc4c4] bg-white px-4 py-2 text-sm font-semibold text-[#8b4141]"><Trash2 className="h-4 w-4" aria-hidden="true" />Delete draft</button>
          </div>
        </div>
      )}

      {capture.dictationFailed ? <p className="mt-3 text-sm text-sema-slate">Browser dictation stopped, but your audio and any captured text are still available for manual review.</p> : null}
    </section>
  );
}
