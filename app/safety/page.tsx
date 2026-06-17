import Link from "next/link";
import { ArrowLeft, CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { SemaShell } from "@/components/layout/SemaShell";

const does = ["Organize patient-provided observations.", "Help users remember details.", "Generate a shareable evidence packet.", "Encourage licensed clinician review."];
const doesNot = ["Diagnose or identify a condition.", "Treat, prescribe, or recommend medication.", "Triage or determine emergency severity.", "Tell users they are safe, unsafe, or should delay care.", "Classify audio or body/location notes as disease or proof."];

export default function SafetyPage() {
  return (
    <SemaShell status="Safety boundary">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/session" className="no-print inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-sage">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to session
        </Link>
        <section className="mt-6 rounded-lg bg-white/88 p-8 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-sage">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            Safety & limitations
          </p>
          <h1 className="mt-4 text-4xl font-bold text-ink">Sema is a signal organizer, not a medical decision system.</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Sema helps package information that a user provides. It is not a diagnosis, treatment plan, emergency guide, medical device, clinician replacement, EHR integration, or storage system.
          </p>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="card rounded-lg p-6">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
              <CheckCircle2 className="h-5 w-5 text-sage" aria-hidden="true" />
              Sema can help with
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="card rounded-lg p-6">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
              <ShieldAlert className="h-5 w-5 text-clay" aria-hidden="true" />
              Sema does not do
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {doesNot.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-clay/20 bg-clay/5 p-6">
          <h2 className="text-xl font-semibold text-ink">Urgent or concerning symptoms</h2>
          <p className="mt-2 text-muted">
            Sema cannot determine whether symptoms are serious or safe. If symptoms feel severe, urgent, rapidly worsening, or concerning to you, seek appropriate medical or emergency care.
          </p>
        </section>
      </main>
    </SemaShell>
  );
}
