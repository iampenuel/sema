"use client";

import { Printer } from "lucide-react";

export function PdfExportButton() {
  function handlePrint() {
    const ok = window.confirm(
      "This packet is generated from patient-provided information. It is not a diagnosis, treatment plan, or emergency guidance. Do you want to export it?"
    );

    if (ok) {
      window.print();
    }
  }

  return (
    <button type="button" onClick={handlePrint} className="no-print inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90">
      <Printer className="h-4 w-4" aria-hidden="true" />
      Export / Print
    </button>
  );
}
