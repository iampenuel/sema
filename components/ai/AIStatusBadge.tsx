"use client";

import { useEffect, useState } from "react";
import { Cpu, Sparkles } from "lucide-react";
import { fetchAIStatus } from "@/lib/ai/client";
import type { AIStatus } from "@/lib/ai/aiTypes";

export function AIStatusBadge({ requestFailed = false }: { requestFailed?: boolean }) {
  const [status, setStatus] = useState<AIStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchAIStatus(controller.signal).then(setStatus).catch(() => setStatus(null));
    return () => controller.abort();
  }, []);
  const enhanced = status?.activeProvider === "gemini" && !requestFailed;
  const label = requestFailed ? "AI request fell back locally" : enhanced ? "AI enhanced" : "Local tools ready";
  const Icon = enhanced ? Sparkles : Cpu;
  return <span title="Sema can continue using local session tools when AI enhancement is unavailable." className="inline-flex items-center gap-1 rounded-full border border-sema-border bg-[#f7f9fa] px-2 py-1 text-[10px] font-semibold text-sema-slate"><Icon className="h-3 w-3 text-sema-blue" aria-hidden="true" />{label}</span>;
}
