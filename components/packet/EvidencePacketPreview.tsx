"use client";

import { FileText, ShieldCheck } from "lucide-react";
import { PdfExportButton } from "./PdfExportButton";
import type { EvidencePacket } from "@/lib/sema-session/types";
import type { RuntimePhotoAttachment } from "@/lib/photo/types";
import { concernTypeLabels, signalTypeLabels } from "@/lib/sema-session/types";

export function EvidencePacketPreview({ packet, runtimePhotos = [] }: { packet?: EvidencePacket; runtimePhotos?: RuntimePhotoAttachment[] }) {
  if (!packet) {
    return (
      <section className="rounded-lg border border-sema-border bg-[#dceaf4] p-3 shadow-card" aria-labelledby="packet-title">
        <div className="rounded-md border border-sema-border bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-sema-blue">EVIDENCE PACKET PREVIEW</p>
              <h2 id="packet-title" className="mt-1 font-editorial text-3xl font-semibold text-ink">Sema Evidence Packet</h2>
            </div>
            <span className="rounded-full bg-[#f1f5f8] px-3 py-1 text-xs font-semibold text-sema-slate">Not prepared</span>
          </div>
          <div className="mt-6 flex flex-col items-center justify-center rounded-md border border-sema-border bg-[#f8fbfd] px-6 py-10 text-center">
            <FileText className="h-8 w-8 text-sema-blue" aria-hidden="true" />
            <p className="mt-3 font-semibold text-ink">No packet prepared yet.</p>
            <p className="mt-1 max-w-lg text-sm leading-6 text-sema-slate">Complete at least one signal folder, then prepare a packet preview.</p>
          </div>
        </div>
      </section>
    );
  }

  const summary = packet.aiOrganizedSummary;

  return (
    <section className="print-packet rounded-lg border border-[#aec7da] bg-[#dceaf4] p-3 shadow-packet" aria-labelledby="packet-title">
      <div className="rounded-md border border-sema-border bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold text-sema-blue">
            <FileText className="h-4 w-4" aria-hidden="true" />
            GENERATED FROM PATIENT-PROVIDED INFORMATION
          </p>
          <h2 id="packet-title" className="mt-2 font-editorial text-3xl font-semibold text-ink">Sema Evidence Packet</h2>
          <p className="mt-1 text-sm text-muted">Generated {new Date(packet.generatedAt).toLocaleString()}</p>
          <p className="mt-1 text-sm text-muted">Concern type: {packet.concernType ? concernTypeLabels[packet.concernType] : "Not selected"}</p>
        </div>
        <PdfExportButton packet={packet} runtimePhotos={runtimePhotos} />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <PacketSection title="Main concern">
          <p className="font-semibold text-ink">{summary?.mainConcern ?? "No approved organized summary."}</p>
        </PacketSection>
        <PacketSection title="Patient's own words">
          <p>{packet.patientWords || "No story provided."}</p>
        </PacketSection>
        <PacketSection title="Organized summary">
          <p className="font-semibold text-ink">{summary?.mainConcern ?? "No summary generated."}</p>
          <p className="mt-2 text-sm text-muted">{summary?.summaryNote}</p>
        </PacketSection>
        {packet.organizedNarrative ? <PacketSection title="Approved packet narrative">
          <p>{packet.organizedNarrative}</p>
          {packet.organizationNotes?.length ? <ul className="mt-2 space-y-1 text-muted">{packet.organizationNotes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
        </PacketSection> : null}
        <PacketSection title="Timeline">
          <ul className="space-y-2">
            {summary?.timeline.map((item) => (
              <li key={item.id}><span className="font-semibold">{item.label}:</span> {item.detail}</li>
            )) ?? <li>No timeline available.</li>}
          </ul>
        </PacketSection>
        <PacketSection title="Body/location observations">
          {packet.bodyLocationObservations.length ? (
            <ul className="space-y-2">
              {packet.bodyLocationObservations.map((item) => (
                <li key={item.id}>{item.regionLabel} · {signalTypeLabels[item.signalType]}{item.intensity ? ` · ${item.intensity}/10` : ""}{item.note ? ` · ${item.note}` : ""}</li>
              ))}
            </ul>
          ) : (
            <p>No body/location observations added.</p>
          )}
        </PacketSection>
        <PacketSection title="Audio observations">
          {packet.audioSignals.length ? (
            <ul className="space-y-2">
              {packet.audioSignals.map((signal) => (
                <li key={signal.id}>{signal.name} · {signal.durationSeconds}s · {signal.tags.join(", ") || "No tags"}{signal.notes ? ` · ${signal.notes}` : ""}{signal.transcript ? ` · Reviewed transcript: ${signal.transcript}` : ""}</li>
              ))}
            </ul>
          ) : (
            <p>No audio observations added.</p>
          )}
        </PacketSection>
        <PacketSection title="Motion/visual notes">
          {packet.motionVisualNotes.length ? (
            <ul className="space-y-2">{packet.motionVisualNotes.map((note) => <li key={note.id}>{note.note}</li>)}</ul>
          ) : <p>No motion/visual notes added.</p>}
        </PacketSection>
        <PacketSection title="Missing details">
          <ul className="space-y-2">
            {packet.missingDetails.length ? packet.missingDetails.map((detail) => <li key={detail}>{detail}</li>) : <li>No approved missing-detail checklist.</li>}
          </ul>
        </PacketSection>
        <PacketSection title="Questions for clinician">
          <ul className="space-y-2">
            {packet.clinicianQuestions.length ? packet.clinicianQuestions.map((question) => <li key={question}>{question}</li>) : <li>No approved clinician questions.</li>}
          </ul>
        </PacketSection>
        <PacketSection title="Safety note">
          <p className="flex gap-2"><ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-sema-green" aria-hidden="true" />{packet.safetyNote}</p>
        </PacketSection>
        <PacketSection title="Important disclaimers">
          <ul className="mt-2 space-y-1">
            {packet.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </PacketSection>
      </div>

      {packet.photoObservations.filter((photo) => photo.includeInPacket).length > 0 && <section className="mt-6 rounded-md border border-sema-border bg-white p-4">
        <h3 className="font-semibold text-ink">Patient-provided photos</h3>
        <p className="mt-1 text-xs font-semibold text-sema-blue">Not clinically analyzed</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{packet.photoObservations.filter((photo) => photo.includeInPacket).map((photo) => {
          const runtime = runtimePhotos.find((attachment) => attachment.metadata.id === photo.id);
          return <article key={photo.id} className="rounded-md border border-sema-border p-3">
            {runtime?.blob ? <p className="text-sm text-sema-slate">Approved current-tab photo will be included in the PDF.</p> : <p className="text-sm text-sema-slate">Photo was not retained by Sema after the browser session.</p>}
            <p className="mt-2 text-sm text-sema-slate">{photo.note || "No note added."}</p>
          </article>;
        })}</div>
      </section>}
      </div>
    </section>
  );
}

function PacketSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print-break-inside-avoid rounded-md border border-sema-border bg-[#f8fbfd] p-4 text-sm leading-6 text-sema-slate">
      <h3 className="mb-2 text-base font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}
