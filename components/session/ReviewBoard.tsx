"use client";

import { useState } from "react";
import { CheckCircle2, Edit3, FileCheck2, Loader2, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { AIFallbackNotice } from "@/components/ai/AIFallbackNotice";
import { AIErrorNotice } from "@/components/ai/AIErrorNotice";
import { SEMAPHASE_SAFETY_NOTE } from "@/lib/safety/safetyCopy";
import type { PacketNarrativeDraft, SemaSession } from "@/lib/sema-session/types";

type Props = {
  session: SemaSession;
  onApprove: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  onRegenerateStory: () => void | Promise<void>;
  onPrepare: () => boolean;
  onDraftPacket: () => void | Promise<void>;
  onApprovePacketDraft: () => void;
  onUpdatePacketDraft: (draft: PacketNarrativeDraft) => void;
  onDiscardPacketDraft: () => void;
  packetDrafting?: boolean;
  onCancelPacketDraft?: () => void;
  packetFallbackNotice?: string | null;
  packetError?: string | null;
};

export function ReviewBoard({ session, onApprove, onEdit, onDiscard, onRegenerateStory, onPrepare, onDraftPacket, onApprovePacketDraft, onUpdatePacketDraft, onDiscardPacketDraft, packetDrafting = false, onCancelPacketDraft, packetFallbackNotice, packetError }: Props) {
  const summary = session.story.structuredSummary;
  const packetNarrative = session.packetNarrativeDraft;
  const [editingPacket, setEditingPacket] = useState(false);
  const [packetEdit, setPacketEdit] = useState<PacketNarrativeDraft | null>(null);
  if (!summary && !packetNarrative) return null;
  const approved = session.story.summaryStatus === "approved";

  function savePacketEdit() {
    if (!packetEdit) return;
    onUpdatePacketDraft(packetEdit);
    setEditingPacket(false);
  }

  return (
    <section className="rounded-lg border border-sema-border bg-white p-4 shadow-card" aria-labelledby="review-board-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold text-sema-blue">REVIEW BEFORE PACKET</p>
          <h2 id="review-board-title" className="mt-1 font-editorial text-2xl font-semibold text-ink">Review Board</h2>
          <p className="mt-1 text-sm text-sema-slate">AI-organized from patient-provided information. Review before saving.</p>
        </div>
        {summary ? <Status approved={approved} /> : null}
      </div>

      {summary ? <div className="mt-4 rounded-md border border-sema-border p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-ink">Story extraction draft</h3>
          <Status approved={approved} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ReviewSection title="Patient's own words">{session.story.rawText || "No story saved."}</ReviewSection>
          <ReviewSection title="Organized summary">{summary.mainConcern}</ReviewSection>
          <ReviewSection title="Missing-detail suggestions">{summary.missingDetails.join(" ")}</ReviewSection>
          <ReviewSection title="Questions for clinician">{summary.clinicianQuestions.join(" ")}</ReviewSection>
          <ReviewSection title="Saved observations">{session.bodyLocation.length} body/location · {session.audioSignals.length} audio · {session.motionVisualNotes.length} motion/visual</ReviewSection>
          <ReviewSection title="Safety note">{SEMAPHASE_SAFETY_NOTE}</ReviewSection>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!approved ? <ActionButton onClick={onApprove} primary icon={CheckCircle2}>Looks accurate</ActionButton> : null}
          <ActionButton onClick={onEdit} icon={Edit3}>Edit</ActionButton>
          <ActionButton onClick={onRegenerateStory} icon={RefreshCw}>Regenerate</ActionButton>
          {!approved ? <ActionButton onClick={onDiscard} danger icon={Trash2}>Remove</ActionButton> : null}
        </div>
      </div> : null}

      <div className="mt-4 rounded-md border border-sema-border p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-ink">Optional packet narrative</h3>
            <p className="text-xs leading-5 text-sema-slate">Drafted only from saved and approved session content.</p>
          </div>
          {packetNarrative ? <Status approved={packetNarrative.status === "approved"} /> : null}
        </div>

        {!packetNarrative ? <button type="button" onClick={onDraftPacket} disabled={packetDrafting || !approved} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-blue-dark disabled:cursor-not-allowed disabled:text-muted">
          {packetDrafting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {packetDrafting ? "Drafting packet narrative..." : "Draft packet narrative"}
        </button> : null}

        {packetDrafting ? <div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-xs font-medium text-sema-slate">Sema is drafting from approved content only.</p>{onCancelPacketDraft ? <button type="button" onClick={onCancelPacketDraft} className="inline-flex items-center gap-1 text-xs font-semibold text-sema-slate"><X className="h-3.5 w-3.5" aria-hidden="true" />Cancel</button> : null}</div> : null}
        {packetFallbackNotice ? <div className="mt-3"><AIFallbackNotice message={packetFallbackNotice} /></div> : null}
        {packetError ? <div className="mt-3"><AIErrorNotice message={packetError} /></div> : null}

        {packetNarrative ? <div className="mt-3 space-y-3">
          {editingPacket ? <>
            <EditableField label="Concise narrative" value={packetEdit?.conciseNarrative ?? packetNarrative.conciseNarrative} onChange={(value) => setPacketEdit({ ...(packetEdit ?? packetNarrative), conciseNarrative: value })} multiline />
            <EditableField label="Missing-detail suggestions" value={(packetEdit?.missingDetails ?? packetNarrative.missingDetails).join("\n")} onChange={(value) => setPacketEdit({ ...(packetEdit ?? packetNarrative), missingDetails: lines(value) })} multiline />
            <EditableField label="Questions for clinician" value={(packetEdit?.clinicianQuestions ?? packetNarrative.clinicianQuestions).join("\n")} onChange={(value) => setPacketEdit({ ...(packetEdit ?? packetNarrative), clinicianQuestions: lines(value) })} multiline />
            <EditableField label="Organization notes" value={(packetEdit?.organizationNotes ?? packetNarrative.organizationNotes).join("\n")} onChange={(value) => setPacketEdit({ ...(packetEdit ?? packetNarrative), organizationNotes: lines(value) })} multiline />
            <div className="flex gap-2"><ActionButton onClick={savePacketEdit} primary icon={CheckCircle2}>Save edits</ActionButton><ActionButton onClick={() => { setPacketEdit(packetNarrative); setEditingPacket(false); }} icon={X}>Cancel</ActionButton></div>
          </> : <>
            <ReviewSection title="Concise narrative">{packetNarrative.conciseNarrative}</ReviewSection>
            <div className="grid gap-3 md:grid-cols-2"><ReviewSection title="Missing-detail suggestions">{packetNarrative.missingDetails.join(" ") || "None drafted."}</ReviewSection><ReviewSection title="Questions for clinician">{packetNarrative.clinicianQuestions.join(" ") || "None drafted."}</ReviewSection></div>
            <ReviewSection title="Organization notes">{packetNarrative.organizationNotes.join(" ") || "None drafted."}</ReviewSection>
            <div className="flex flex-wrap gap-2">
              {packetNarrative.status !== "approved" ? <ActionButton onClick={onApprovePacketDraft} primary icon={CheckCircle2}>Looks accurate</ActionButton> : null}
              <ActionButton onClick={() => { setPacketEdit(packetNarrative); setEditingPacket(true); }} icon={Edit3}>Edit</ActionButton>
              <ActionButton onClick={onDraftPacket} icon={RefreshCw}>Regenerate</ActionButton>
              <ActionButton onClick={onDiscardPacketDraft} danger icon={Trash2}>Remove</ActionButton>
            </div>
          </>}
        </div> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton onClick={onPrepare} disabled={Boolean(summary && !approved) || packetNarrative?.status === "needs_review"} primary icon={FileCheck2}>Prepare packet</ActionButton>
      </div>
    </section>
  );
}

function lines(value: string) { return value.split("\n").map((item) => item.trim()).filter(Boolean); }

function Status({ approved }: { approved: boolean }) {
  return <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${approved ? "bg-[#e8f4ef] text-sema-green" : "bg-[#fff5df] text-[#7b5a20]"}`}>{approved ? "Approved" : "Needs review"}</span>;
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-md border border-sema-border bg-[#f8fbfd] p-3 text-sm leading-5 text-sema-slate"><h4 className="mb-1 font-semibold text-ink">{title}</h4>{children}</div>;
}

function EditableField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="block text-sm font-semibold text-ink">{label}{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-sema-border p-3 text-sm font-normal text-ink" /> : <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-sema-border p-3 text-sm font-normal text-ink" />}</label>;
}

function ActionButton({ children, onClick, icon: Icon, primary = false, danger = false, disabled = false }: { children: React.ReactNode; onClick: () => void | boolean | Promise<void>; icon: typeof CheckCircle2; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  const style = primary ? "bg-sema-blue text-white disabled:bg-[#9aabba]" : danger ? "border border-[#e1c7c7] bg-white text-[#914545]" : "border border-sema-border bg-white text-sema-blue-dark";
  return <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed ${style}`}><Icon className="h-4 w-4" aria-hidden="true" />{children}</button>;
}
