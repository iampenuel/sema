import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { SemaSessionVisual } from "@/components/landing/SemaSessionVisual";

export function HeroSection() {
  return (
    <section id="about" className="relative mx-auto grid max-w-7xl gap-8 px-4 pb-10 pt-12 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16 lg:px-8 lg:pb-10 lg:pt-12 xl:gap-20">
      <div className="relative z-10 max-w-2xl">
        <p className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-sema-blue">
          <span className="h-1.5 w-1.5 rounded-full bg-sema-green" aria-hidden="true" />
          Patient-generated evidence, organized clearly
        </p>
        <h1 className="font-editorial text-[2.7rem] font-semibold leading-[1.04] text-ink sm:text-[3.6rem] lg:text-[3.8rem] xl:text-[4rem]">
          Capture the signal before care begins.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-sema-slate sm:text-xl sm:leading-9">
          Sema helps you preserve what happened, when it started, where you noticed it, what changed, and what you want to ask a clinician.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/session" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-sema-blue px-5 py-3 font-semibold text-white shadow-blue transition hover:bg-sema-blue-dark">
            Start a Sema Session
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href="/safety" className="inline-flex min-h-12 items-center justify-center gap-2 px-4 py-3 font-semibold text-sema-blue-dark transition hover:text-sema-blue">
            <ShieldCheck className="h-4 w-4 text-sema-green" aria-hidden="true" />
            View Privacy &amp; Safety
          </Link>
        </div>
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[660px] lg:mx-0">
        <SemaSessionVisual />
      </div>
    </section>
  );
}
