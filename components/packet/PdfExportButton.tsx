"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { createAgentAction } from "@/lib/agent/actionRegistry";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import { downloadEvidencePacketPdf } from "@/lib/packet/pdfExport";
import type { EvidencePacket } from "@/lib/sema-session/types";
import type { PacketReadinessDecision } from "@/lib/sema-session/selectors";
import { packetNotReadyMessage } from "@/lib/sema-session/selectors";
import type { RuntimePhotoAttachment } from "@/lib/photo/types";

export function PdfExportButton({ packet, runtimePhotos = [], readiness }: { packet: EvidencePacket; runtimePhotos?: RuntimePhotoAttachment[]; readiness?: PacketReadinessDecision }) {
  const [status, setStatus] = useState<"idle" | "generating" | "downloaded" | "error">("idle");
  const [notice, setNotice] = useState("");

  async function handleDownload() {
    if (status === "generating") return;
    if (readiness && !readiness.ready) {
      setNotice(packetNotReadyMessage(readiness));
      return;
    }
    const decision = evaluatePermission(createAgentAction("exportPacketPdf"));
    const ok = window.confirm(decision.message);

    if (ok) {
      setStatus("generating");
      try {
        await downloadEvidencePacketPdf(packet, runtimePhotos);
        setStatus("downloaded");
        setNotice("");
      } catch {
        setStatus("error");
      }
    }
  }

  return (
    <div className="no-print">
      <button type="button" onClick={handleDownload} disabled={status === "generating"} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white hover:bg-sema-blue-dark disabled:cursor-wait disabled:opacity-70">
        {status === "generating" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        {status === "generating" ? "Creating PDF..." : "Download Evidence Packet"}
      </button>
      <p className={`mt-1 max-w-56 text-xs ${status === "error" ? "text-red-700" : "text-sema-slate"}`} role="status" aria-live="polite">
        {notice || (status === "downloaded" ? "The evidence packet PDF was downloaded." : status === "error" ? "Sema could not create the PDF. Your packet is still available." : "")}
      </p>
    </div>
  );
}
