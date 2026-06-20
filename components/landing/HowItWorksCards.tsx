import { AudioLines, FileCheck2, MessageSquareText } from "lucide-react";

const steps = [
  { icon: MessageSquareText, number: "01", title: "Tell the story", text: "Capture your health narrative in your own words." },
  { icon: AudioLines, number: "02", title: "Capture the signal", text: "Add body/location observations, audio notes, and changes over time." },
  { icon: FileCheck2, number: "03", title: "Prepare the packet", text: "Organize everything into a structured report for your clinician." }
];

export function HowItWorksCards() {
  return (
    <section id="how-it-works" className="relative bg-[#edf5fa]/75 py-14 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-semibold text-sema-blue">How it works</p>
            <h2 className="mt-2 font-editorial text-3xl font-semibold text-ink sm:text-4xl">From observation to conversation.</h2>
          </div>
          <p className="hidden max-w-sm text-sm leading-6 text-sema-slate md:block">A focused path for preserving details before a clinical visit.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <article key={step.title} className="signal-card rounded-lg border border-sema-border bg-white p-6 shadow-card">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-sema-pale text-sema-blue">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-bold text-sema-blue/45">{step.number}</span>
              </div>
              <h3 className="mt-5 text-xl font-bold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-sema-slate">{step.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
