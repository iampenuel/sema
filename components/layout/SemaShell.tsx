import Link from "next/link";
import { Home, ShieldCheck } from "lucide-react";

export function SemaShell({
  children,
  status = "Demo-safe session",
  landing = false,
  session = false
}: {
  children: React.ReactNode;
  status?: string;
  landing?: boolean;
  session?: boolean;
}) {
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-sema-border/70 bg-white/88 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8" aria-label="Main navigation">
          <Link href="/" className="flex items-center gap-2.5 text-2xl font-bold text-ink">
            <span className="brand-mark" aria-hidden="true"><span /></span>
            <span>Sema</span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-sema-slate sm:gap-5">
            {landing ? (
              <>
                <Link href="#about" className="hidden font-medium transition hover:text-sema-blue md:block">About</Link>
                <Link href="#how-it-works" className="hidden font-medium transition hover:text-sema-blue md:block">How it Works</Link>
                <Link href="/safety" className="hidden font-medium transition hover:text-sema-blue sm:block">Safety</Link>
                <Link href="/session" className="rounded-md border border-sema-border bg-sema-pale/60 px-3 py-2 font-semibold text-sema-blue-dark transition hover:border-sema-blue/40 hover:bg-sema-pale">Start Session</Link>
              </>
            ) : session ? (
              <>
                <span className="hidden font-semibold text-sema-blue-dark sm:inline">Session</span>
                <Link href="/safety" className="inline-flex items-center gap-1.5 font-medium transition hover:text-sema-blue">
                  <ShieldCheck className="h-4 w-4 text-sema-green" aria-hidden="true" />
                  Safety
                </Link>
                <Link href="/" className="inline-flex items-center gap-1.5 rounded-md border border-sema-border bg-white px-3 py-2 font-semibold text-sema-blue-dark transition hover:bg-sema-pale">
                  <Home className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Home</span>
                </Link>
              </>
            ) : (
              <>
                <span className="hidden rounded-full border border-sema-border bg-white px-3 py-1.5 sm:inline-flex">{status}</span>
                <Link href="/safety" className="inline-flex items-center gap-2 rounded-full border border-sema-border bg-white px-3 py-1.5 font-medium text-ink hover:border-sema-blue/40">
                  <ShieldCheck className="h-4 w-4 text-sema-green" aria-hidden="true" />
                  Safety
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
