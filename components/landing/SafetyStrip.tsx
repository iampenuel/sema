import { ShieldCheck } from "lucide-react";

export function SafetyStrip() {
  return (
    <section id="safety-boundary" className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-lg border border-sema-border bg-white/90 p-5 shadow-card sm:flex-row sm:items-center sm:p-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e9f4ef] text-sema-green">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-ink">A clear safety boundary</h2>
          <p className="mt-1 text-sm leading-6 text-sema-slate">
            Sema is not an AI doctor. It does not diagnose, treat, prescribe, or triage. It helps organize patient-provided observations for clinical conversations.
          </p>
        </div>
      </div>
    </section>
  );
}
