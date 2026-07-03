import Link from "next/link";
import { ArrowLeft, CheckCircle2, Database, FileDown, Mic, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { SemaShell } from "@/components/layout/SemaShell";
import { IMPORTANT_DISCLAIMERS_LABEL, PRIVACY_DISCLOSURES } from "@/lib/safety/safetyCopy";

const does = ["Organize patient-provided observations.", "Help users remember details.", "Generate a shareable evidence packet.", "Encourage licensed clinician review."];
const doesNot = ["Diagnose or identify a condition.", "Treat, prescribe, or recommend medication.", "Triage or determine emergency severity.", "Tell users they are safe, unsafe, or should delay care.", "Classify audio or body/location notes as disease or proof.", "Analyze photos medically or guarantee automated content screening is correct."];

function renderDisclosureDetail(detail: string) {
  return detail.split("\n\n").map((paragraph) => (
    <p key={paragraph} className="mt-2 text-sm leading-6 text-muted">
      {paragraph.split(/(\*\*[^*]+\*\*)/g).map((part) => part.startsWith("**") && part.endsWith("**")
        ? <strong key={part} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
        : part)}
    </p>
  ));
}

export default function SafetyPage() {
  const privacyIcons = [Database, Sparkles, Mic, Mic, FileDown, ShieldCheck];

  return (
    <SemaShell status="Privacy & Safety">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/session" className="no-print inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-sage">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to session
        </Link>
        <section className="mt-6 rounded-lg bg-white/88 p-8 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-sage">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            Privacy &amp; Safety
          </p>
          <h1 className="mt-4 text-4xl font-bold text-ink">Clear boundaries and transparent information handling.</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Sema organizes information that you provide. It is not a diagnosis, treatment plan, emergency guide, medical device, clinician replacement, EHR integration, or durable clinical record.
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
              {IMPORTANT_DISCLAIMERS_LABEL}
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {doesNot.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-6 rounded-lg bg-white/88 p-6 shadow-soft sm:p-8" aria-labelledby="privacy-title">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sema-blue">YOUR INFORMATION</p>
          <h2 id="privacy-title" className="mt-2 text-2xl font-semibold text-ink">How information is handled in this phase</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">This is product transparency about the current prototype, not a formal privacy policy or legal advice.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {PRIVACY_DISCLOSURES.map((item, index) => {
              const Icon = privacyIcons[index];
              return (
                <article key={item.title} className="rounded-md border border-sema-border bg-[#f8fbfd] p-4">
                  <h3 className="flex items-center gap-2 font-semibold text-ink">
                    <Icon className="h-4 w-4 text-sema-blue" aria-hidden="true" />
                    {item.title}
                  </h3>
                  {renderDisclosureDetail(item.detail)}
                </article>
              );
            })}
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
