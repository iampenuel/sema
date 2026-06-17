import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function SemaShell({
  children,
  status = "Demo-safe session"
}: {
  children: React.ReactNode;
  status?: string;
}) {
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-ink/10 bg-white/82 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8" aria-label="Main navigation">
          <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
            <span>Sema</span>
            <span className="h-2.5 w-2.5 rounded-full bg-sage" aria-hidden="true" />
          </Link>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="hidden rounded-full border border-ink/10 bg-white px-3 py-1.5 sm:inline-flex">{status}</span>
            <Link href="/safety" className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 font-medium text-ink hover:border-blue/30">
              <ShieldCheck className="h-4 w-4 text-sage" aria-hidden="true" />
              Safety
            </Link>
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
