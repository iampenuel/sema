"use client";

import { FileText } from "lucide-react";
import { PdfExportButton } from "./PdfExportButton";
import type { EvidencePacket } from "@/lib/sema-session/types";
import { concernTypeLabels, signalTypeLabels } from "@/lib/sema-session/types";

export function EvidencePacketPreview({ packet }: { packet?: EvidencePacket }) {
  if (!packet) {
    return (
      <section className="card rounded-lg p-5" aria-labelledby="packet-title">
        <h2 id="packet-title" className="text-2xl font-bold text-ink">Evidence packet preview</h2>
        <p className="mt-2 rounded-lg border border-dashed border-ink/20 bg-white/70 p-4 text-sm text-muted">
          No packet yet. Prepare a packet draft when you are ready.
        </p>
      </section>
    );
  }

  const summary = packet.aiOrganizedSummary;

  return (
    <section className="print-packet card rounded-lg p-5" aria-labelledby="packet-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-sage">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Generated from patient-provided information
          </p>
          <h2 id="packet-title" className="mt-2 text-3xl font-bold text-ink">Sema Evidence Packet</h2>
          <p className="mt-1 text-sm text-muted">Generated {new Date(packet.generatedAt).toLocaleString()}</p>
          <p className="mt-1 text-sm text-muted">Concern type: {packet.concernType ? concernTypeLabels[packet.concernType] : "Not selected"}</p>
        </div>
        <PdfExportButton />
      </div>

      <div className="mt-6 grid gap-4">
        <PacketSection title="Patient's own words">
          <p>{packet.patientWords || "No story provided."}</p>
        </PacketSection>
        <PacketSection title="AI-organized summary">
          <p className="font-semibold text-ink">{summary?.mainConcern ?? "No summary generated."}</p>
          <p className="mt-2 text-sm text-muted">{summary?.summaryNote}</p>
        </PacketSection>
        <PacketSection title="Timeline">
          <ul className="space-y-2">
            {summary?.timeline.map((item) => (
              <li key={item.id}><span className="font-semibold">{item.label}:</span> {item.detail}</li>
            )) ?? <li>No timeline available.</li>}
          </ul>
        </PacketSection>
        <PacketSection title="Body/location observations">
          {packet.bodyMapObservations.length ? (
            <ul className="space-y-2">
              {packet.bodyMapObservations.map((item) => (
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
                <li key={signal.id}>{signal.name} · {signal.durationSeconds}s · {signal.tags.join(", ") || "No tags"}{signal.notes ? ` · ${signal.notes}` : ""}</li>
              ))}
            </ul>
          ) : (
            <p>No audio observations added.</p>
          )}
        </PacketSection>
        <PacketSection title="Missing details">
          <ul className="space-y-2">
            {summary?.missingDetails.map((detail) => <li key={detail}>{detail}</li>) ?? <li>No missing detail checklist generated.</li>}
          </ul>
        </PacketSection>
        <PacketSection title="Questions for clinician">
          <ul className="space-y-2">
            {summary?.clinicianQuestions.map((question) => <li key={question}>{question}</li>) ?? <li>No clinician questions generated.</li>}
          </ul>
        </PacketSection>
        <PacketSection title="Safety and limitations">
          <p>{packet.safetyNote}</p>
          <ul className="mt-2 space-y-1">
            {packet.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </PacketSection>
      </div>
    </section>
  );
}

function PacketSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print-break-inside-avoid rounded-lg border border-ink/10 bg-white p-4 text-sm leading-6 text-muted">
      <h3 className="mb-2 text-base font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}
