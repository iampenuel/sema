import { Info } from "lucide-react";

export const AI_FALLBACK_COPY = "AI enhancement is unavailable right now. Sema is continuing in local mode, and your saved session data is still available.";

export function AIFallbackNotice({ message = AI_FALLBACK_COPY }: { message?: string }) {
  return <p className="flex items-start gap-2 rounded-md border border-[#d8e2e8] bg-[#f7f9fa] px-3 py-2 text-xs leading-5 text-sema-slate"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sema-blue" aria-hidden="true" />{message}</p>;
}
