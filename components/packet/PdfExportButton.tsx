"use client";

import { Printer } from "lucide-react";
import { createAgentAction } from "@/lib/agent/actionRegistry";
import { evaluatePermission } from "@/lib/agent/permissionGate";

export function PdfExportButton() {
  function handlePrint() {
    const decision = evaluatePermission(createAgentAction("exportPacketPdf"));
    const ok = window.confirm(decision.message);

    if (ok) {
      window.print();
    }
  }

  return (
    <button type="button" onClick={handlePrint} className="no-print inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white hover:bg-sema-blue-dark">
      <Printer className="h-4 w-4" aria-hidden="true" />
      Download Evidence Packet
    </button>
  );
}
