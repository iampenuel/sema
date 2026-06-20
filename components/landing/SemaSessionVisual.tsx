import Image from "next/image";
import {
  AudioLines,
  Check,
  ChevronRight,
  FileCheck2,
  MapPinned,
  MessageSquareText,
  ShieldCheck
} from "lucide-react";

const signals = [
  { icon: MessageSquareText, title: "Story captured", detail: "Patient's own words" },
  { icon: MapPinned, title: "Body/location marked", detail: "2 observations" },
  { icon: AudioLines, title: "Audio observation added", detail: "Voice note saved" }
];

export function SemaSessionVisual() {
  return (
    <div className="relative mx-auto min-h-[690px] w-full max-w-[640px] sm:min-h-[480px]" aria-label="Sema Session Workspace showing captured signals and a prepared evidence packet draft">
      <div className="session-visual-halo absolute inset-8 rounded-full" aria-hidden="true" />
      <div className="absolute right-0 top-4 hidden w-[235px] sm:block">
        <EvidencePacketDraft />
      </div>

      <div className="relative z-10 w-full rounded-lg border border-[#aac5d9] bg-[#dceaf4] p-2.5 shadow-packet sm:mt-8 sm:max-w-[470px]">
        <div className="rounded-md border border-sema-border bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4 border-b border-sema-border/75 pb-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-sema-blue">
                <span className="h-1.5 w-1.5 rounded-full bg-sema-green" aria-hidden="true" />
                ACTIVE SEMA SESSION
              </div>
              <h2 className="mt-1.5 text-xl font-bold text-ink">Capture workspace</h2>
            </div>
            <span className="rounded-full bg-sema-pale px-2.5 py-1 text-[10px] font-semibold text-sema-blue-dark">3 signals added</span>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {signals.map((signal) => (
              <article key={signal.title} className="min-h-[112px] rounded-md border border-sema-border bg-[#f8fbfd] p-3">
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sema-pale text-sema-blue">
                    <signal.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e8f4ef] text-sema-green">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                </div>
                <h3 className="mt-3 text-xs font-bold leading-4 text-ink">{signal.title}</h3>
                <p className="mt-1 text-[10px] leading-4 text-sema-slate">{signal.detail}</p>
              </article>
            ))}
          </div>

          <div className="my-3 flex items-center gap-2 text-[10px] font-semibold text-sema-blue/75" aria-hidden="true">
            <span className="h-px flex-1 bg-sema-border" />
            Observations organized
            <ChevronRight className="h-3.5 w-3.5" />
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-[#b9d2e3] bg-sema-pale/70 p-3 sm:flex-row sm:items-center">
            <Image
              src="/images/sema-agent.png"
              alt="Sema agent"
              width={326}
              height={366}
              sizes="52px"
              className="h-auto w-[52px] shrink-0"
              priority
            />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold text-sema-blue">SEMA</p>
              <p className="mt-0.5 text-xs font-semibold leading-5 text-ink">I can organize these observations into a packet.</p>
            </div>
            <span className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-sema-blue px-3 text-xs font-semibold text-white shadow-sm">
              Prepare packet
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>

      <div className="relative z-20 -mt-3 ml-auto w-[220px] sm:hidden">
        <EvidencePacketDraft />
      </div>
    </div>
  );
}

function EvidencePacketDraft() {
  return (
    <div className="relative aspect-[1.15] rounded-lg border border-[#abc4d7] bg-[#cbddeb] p-2 shadow-soft">
      <div className="absolute -right-2 top-3 -z-10 h-full w-full rounded-lg border border-[#bfd1df] bg-[#e2edf5]" aria-hidden="true" />
      <div className="h-full rounded-md border border-sema-border bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[8px] font-bold text-sema-blue">OUTPUT</p>
            <h3 className="mt-0.5 text-xs font-bold text-ink">Evidence Packet Draft</h3>
          </div>
          <FileCheck2 className="h-4 w-4 shrink-0 text-sema-blue" aria-hidden="true" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <PacketRow icon={MessageSquareText} label="Patient's words" />
          <PacketRow icon={MapPinned} label="Observations" />
          <PacketRow icon={AudioLines} label="Audio note" />
          <PacketRow icon={ShieldCheck} label="Safety note" safety />
        </div>
      </div>
    </div>
  );
}

function PacketRow({ icon: Icon, label, safety = false }: { icon: typeof MessageSquareText; label: string; safety?: boolean }) {
  return (
    <div className={`min-h-[48px] rounded border px-2 py-2 ${safety ? "border-[#c5dcd4] bg-[#f0f7f4]" : "border-sema-border/80 bg-[#f8fbfd]"}`}>
      <div className="flex items-center gap-1.5 text-[8px] font-semibold text-ink">
        <Icon className={`h-2.5 w-2.5 ${safety ? "text-sema-green" : "text-sema-blue"}`} aria-hidden="true" />
        {label}
      </div>
      <span className="ml-4 mt-1 block h-0.5 w-2/3 rounded-full bg-[#c5d5e1]" aria-hidden="true" />
    </div>
  );
}
