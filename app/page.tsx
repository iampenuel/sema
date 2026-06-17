import Link from "next/link";
import { ArrowRight, FileText, MapPinned, Mic, ShieldCheck } from "lucide-react";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { SemaShell } from "@/components/layout/SemaShell";

const captureItems = [
  { icon: FileText, title: "Story", text: "What happened, when it started, what changed, and what you are worried about." },
  { icon: MapPinned, title: "Body/location", text: "Patient-reported location notes such as pain, stiffness, swelling, or discomfort." },
  { icon: Mic, title: "Audio signal", text: "A recording or note included as an observation, never as a disease classification." }
];

export default function HomePage() {
  return (
    <SemaShell status="Phase 1 prototype">
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sage">Patient-generated evidence reporter</p>
            <h1 className="mt-5 max-w-3xl text-5xl font-bold leading-tight text-ink sm:text-6xl">
              Capture the signal before care begins.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
              Sema helps people preserve health-related observations in their own words, organize them into a clinician-readable packet, and keep the safety boundary clear.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/session" className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-5 py-3 font-semibold text-white shadow-soft hover:bg-ink/90">
                Start a Sema session
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/safety" className="inline-flex items-center justify-center gap-2 rounded-lg border border-ink/12 bg-white px-5 py-3 font-semibold text-ink hover:border-sage/40">
                View safety & limitations
              </Link>
            </div>
          </div>
          <div className="card rounded-lg p-5">
            <SafetyBanner />
            <div className="mt-5 rounded-lg border border-dashed border-sage/30 bg-sage/5 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sage">Demo scenario</p>
              <h2 className="mt-2 text-2xl font-bold text-ink">Student wrist pain after basketball practice</h2>
              <p className="mt-3 text-muted">
                Public demo users can load synthetic data to see how Sema organizes a story, location notes, audio metadata, missing details, and clinician questions.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-3">
          {captureItems.map((item) => (
            <article key={item.title} className="card rounded-lg p-5">
              <item.icon className="h-6 w-6 text-clay" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-semibold text-ink">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-lg border border-ink/10 bg-white/82 p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-6 w-6 text-sage" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-ink">Capture the signal. Preserve the story. Package it safely.</h2>
              <p className="mt-2 max-w-4xl text-muted">
                Sema does not diagnose, treat, prescribe, triage, classify audio as disease, or decide whether someone is safe. It is a structured capture prototype for patient-provided observations.
              </p>
            </div>
          </div>
        </section>
      </main>
    </SemaShell>
  );
}
